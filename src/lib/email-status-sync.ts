import { acquireWorkerLock } from "./db/worker-lock";
/**
 * NHN 발송 결과 자동 맞추기 (SND-1) — docs/2026-10-11-reply-and-health/DESIGN-SND.md 3절.
 *
 * 10분마다 NHN "상태가 바뀐 메일 목록"(update-mails)을 커서로 이어 읽어 SST 코드 그대로 발송 기록에 적는다.
 *   - 커서: email_status_sync_state.update_cursor (처음은 now − NHN_STATUS_BACKFILL_DAYS). 창 [커서 − 5분, min(커서 + 1시간, now − 1분)]을
 *     쪽 끝까지 다 읽은 뒤에만 커서를 창 끝으로 옮긴다 — 장애 뒤에도 커서부터 이어 읽는다
 *   - 같은 appKey를 쓰는 조직은 한 번만 읽고 결과를 조직 조건으로 나눠 쓴다 (커서는 묶음마다 하나, 조직 줄마다 같은 값)
 *   - 짝짓기: 요청 번호 (샌드비 발송은 1통 1요청). 짝이 여럿이면 요청 번호 조회(받는 주소 포함)로
 *   - 보조 질문(3-3): 2~48시간 지났는데 NHN 결과가 없는 기록만, 한 기록 3번까지, 회차 NHN_STATUS_FALLBACK_CALLS번까지
 *   - 모든 쓰기는 applyNhnStatuses 한 문장을 지난다 (커서·보조 질문·화면 버튼) — 반송 안내(dsn)로 실패가 된 기록은 SST2가 와도 failed로 남는다
 * 잠금 0x5c4edf08 — 두 회차가 겹치지 않는다. 예산: NHN 질문 NHN_STATUS_SYNC_MAX_CALLS, 시간 4분, 묶음 동시 3개.
 * 오류 글·로그에 받는 주소·키를 넣지 않는다. dsnMessage는 DB에만 둔다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { NhnEmailClient } from "@/lib/nhn-email";
import type { NhnEmailQueryResult, NhnUpdatedMail } from "@/lib/nhn-email";
import {
    classifyNhnFailure,
    formatNhnDateTime,
    initialCursor,
    isCursorCaughtUp,
    mapNhnStatus,
    nextUpdateWindow,
    pairNhnRows,
    pairUpdatedMails,
    resolveStatusSyncConfig,
    splitBudget,
} from "@/lib/email-status-sync-rules";
import type { NhnFailureKind, NhnStatusWrite, StatusSyncConfig } from "@/lib/email-status-sync-rules";

export const STATUS_SYNC_LOCK_KEY = 0x5c4edf08;
/** 회차 시간 예산 */
const TIME_BUDGET_MS = 4 * 60 * 1000;
/** 묶음 동시 처리 수 */
const GROUP_CONCURRENCY = 3;
/** 한 묶음에서 연속 오류가 이만큼이면 그 묶음은 이번 회차 그만 (3-5) */
const MAX_CONSECUTIVE_ERRORS = 5;
/** applyNhnStatuses 한 문장의 줄 수 */
const WRITE_CHUNK = 200;
const IN_CHUNK = 1000;
/** 보조 질문: 이 시간보다 오래되고 48시간보다 새로운 기록만 (커서가 보통 이 안에 결과를 준다) */
const FALLBACK_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const FALLBACK_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const FALLBACK_MAX_CHECKS = 3;

export interface StatusSyncStats {
    groups: number;
    calls: number;
    windows: number;
    updated: number;
    finalized: number;
    failedNew: number;
    unpaired: number;
    fallbackCalls: number;
    errors: number;
    skippedWindows: number;
    skippedAsLocked?: boolean;
    skipped?: "off";
}

export interface StatusSyncOptions {
    now?: Date;
    env?: Record<string, string | undefined>;
    /** 회차 NHN 질문 상한 (생략하면 설정 값). 화면 버튼은 100 */
    maxCalls?: number;
    trigger?: "cron" | "manual";
}

interface ConfigRow {
    org_id: string;
    app_key: string;
    secret_key: string;
}

interface SyncGroup {
    key: string;
    appKey: string;
    secretKey: string;
    orgIds: string[];
}

interface StateRow {
    org_id: string;
    update_cursor: Date | string | null;
    initial_from: Date | string | null;
    initial_done_at: Date | string | null;
    consecutive_errors: number;
}

interface GroupResult {
    calls: number;
    windows: number;
    updated: number;
    finalized: number;
    failedNew: number;
    unpaired: number;
    fallbackCalls: number;
    errors: number;
    skippedWindows: number;
}

const emptyStats = (): StatusSyncStats => ({
    groups: 0,
    calls: 0,
    windows: 0,
    updated: 0,
    finalized: 0,
    failedNew: 0,
    unpaired: 0,
    fallbackCalls: 0,
    errors: 0,
    skippedWindows: 0,
});

const warnedCodes = new Set<string>();

function toDate(v: Date | string | null | undefined): Date | null {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}

/** 오류 글 — 키·주소를 넣지 않는다 */
function failureText(kind: NhnFailureKind, httpStatus: number | null): string {
    const code = httpStatus ? ` (HTTP ${httpStatus})` : "";
    if (kind === "auth") return `NHN 키 확인 필요${code}`;
    if (kind === "rate_limited") return `NHN 질문 한도 초과${code}`;
    if (kind === "rejected_window") return `NHN이 오래된 기간 조회를 거절${code}`;
    return `NHN 조회 일시 오류${code}`;
}

/** 회차 질문 예산 (묶음 여럿이 나눠 쓴다) */
class CallBudget {
    used = 0;
    constructor(private limit: number, private deadline: number) {}
    canCall(): boolean {
        return this.used < this.limit && Date.now() < this.deadline;
    }
    use(): void {
        this.used++;
    }
    left(): number {
        return Math.max(0, this.limit - this.used);
    }
    give(n: number): void {
        this.limit += Math.max(0, n);
    }
}

// ============================================
// 진입점
// ============================================

/** cron (POST /api/email/status-sync/process) — 모든 조직의 appKey 묶음 */
export async function runStatusSync(opts: StatusSyncOptions = {}): Promise<StatusSyncStats> {
    const config = resolveStatusSyncConfig(opts.env ?? process.env);
    if (!config.enabled) return { ...emptyStats(), skipped: "off" };
    return withSyncLock(async () => {
        const groups = await loadGroups(null);
        return syncGroups(groups, config, opts);
    });
}

/**
 * 한 조직의 결과 맞추기 — 화면 버튼(POST /api/email/logs/sync)도 같은 함수를 쓴다 (3-7: 결과 기록 규칙이 두 벌이면 한쪽만 고쳐진다).
 * 그 조직이 든 appKey 묶음의 커서 따라잡기 + 보조 질문. 이메일 설정이 없으면 null.
 */
export async function syncOrgStatuses(orgId: string, opts: StatusSyncOptions = {}): Promise<StatusSyncStats | null> {
    const config = resolveStatusSyncConfig(opts.env ?? process.env);
    const groups = await loadGroups(orgId);
    if (groups.length === 0) return null;
    return withSyncLock(() => syncGroups(groups, config, { ...opts, maxCalls: opts.maxCalls ?? 100, trigger: opts.trigger ?? "manual" }));
}

async function withSyncLock(run: () => Promise<StatusSyncStats>): Promise<StatusSyncStats> {
    // 잠금 전용 연결은 공유 조회 풀에서 분리하고 회차 종료 시 닫는다.
    const workerLock = await acquireWorkerLock(STATUS_SYNC_LOCK_KEY);
    try {
        if (!workerLock) {
            console.log("[status-sync] 다른 회차가 도는 중 — 건너뜀");
            return { ...emptyStats(), skippedAsLocked: true };
        }
        return await run();
    } finally {
        await workerLock?.release();
    }
}

/** 켜진 이메일 설정을 appKey 묶음으로 (orgId를 주면 그 조직이 든 묶음 하나) */
async function loadGroups(orgId: string | null): Promise<SyncGroup[]> {
    const rows = (await db.execute(sql`
        SELECT org_id, app_key, secret_key FROM email_configs WHERE is_active = 1 ORDER BY org_id
    `)) as unknown as ConfigRow[];
    const byKey = new Map<string, SyncGroup>();
    for (const r of rows) {
        if (!r.app_key || !r.secret_key) continue;
        const key = `${r.app_key}|${r.secret_key}`;
        const g = byKey.get(key) ?? { key, appKey: r.app_key, secretKey: r.secret_key, orgIds: [] };
        if (!g.orgIds.includes(r.org_id)) g.orgIds.push(r.org_id);
        byKey.set(key, g);
    }
    const groups = [...byKey.values()];
    return orgId === null ? groups : groups.filter((g) => g.orgIds.includes(orgId));
}

async function syncGroups(groups: SyncGroup[], config: StatusSyncConfig, opts: StatusSyncOptions): Promise<StatusSyncStats> {
    const now = opts.now ?? new Date();
    const stats = emptyStats();
    stats.groups = groups.length;
    if (groups.length === 0) return stats;

    const deadline = Date.now() + TIME_BUDGET_MS;
    const total = opts.maxCalls ?? config.maxCalls;
    const states = await loadStates(groups.flatMap((g) => g.orgIds));
    // 밀린 창 수(+ 보조 질문 몫)로 예산을 나눈다. 남는 몫은 뒤에 밀린 묶음에 다시 준다 (splitBudget 물 채우기)
    const demands = groups.map((g) => {
        const cursor = groupCursor(g, states) ?? initialCursor(now, config.backfillDays);
        const windows = Math.max(1, Math.ceil((now.getTime() - cursor.getTime()) / (60 * 60 * 1000)));
        return windows * 2 + config.fallbackCalls;
    });
    const shares = splitBudget(total, demands);
    const fallbackLeft = { n: config.fallbackCalls };
    const spare = { n: total - shares.reduce((a, b) => a + b, 0) };

    let next = 0;
    const worker = async () => {
        while (next < groups.length) {
            const i = next++;
            const budget = new CallBudget(shares[i] + takeSpare(spare, demands[i] - shares[i]), deadline);
            const r = await syncGroup(groups[i], states, config, budget, fallbackLeft, now, opts.trigger ?? "cron");
            // 다 못 쓴 몫은 뒤 묶음에 준다
            spare.n += budget.left();
            stats.calls += r.calls;
            stats.windows += r.windows;
            stats.updated += r.updated;
            stats.finalized += r.finalized;
            stats.failedNew += r.failedNew;
            stats.unpaired += r.unpaired;
            stats.fallbackCalls += r.fallbackCalls;
            stats.errors += r.errors;
            stats.skippedWindows += r.skippedWindows;
        }
    };
    await Promise.all(Array.from({ length: Math.min(GROUP_CONCURRENCY, groups.length) }, worker));
    console.log(
        `[status-sync] groups=${stats.groups} calls=${stats.calls} windows=${stats.windows} updated=${stats.updated} ` +
        `finalized=${stats.finalized} failedNew=${stats.failedNew} unpaired=${stats.unpaired} fallback=${stats.fallbackCalls} ` +
        `errors=${stats.errors} skippedWindows=${stats.skippedWindows}`
    );
    return stats;
}

function takeSpare(spare: { n: number }, want: number): number {
    const give = Math.max(0, Math.min(spare.n, want));
    spare.n -= give;
    return give;
}

async function loadStates(orgIds: string[]): Promise<Map<string, StateRow>> {
    const out = new Map<string, StateRow>();
    if (orgIds.length === 0) return out;
    const rows = (await db.execute(sql`
        SELECT org_id, update_cursor, initial_from, initial_done_at, consecutive_errors
        FROM email_status_sync_state WHERE org_id = ANY(${sql.param(orgIds)}::uuid[])
    `)) as unknown as StateRow[];
    for (const r of rows) out.set(r.org_id, r);
    return out;
}

/** 묶음의 커서 — 조직 줄 중 가장 앞선 값 (대표 조직이 바뀌어도 이어 간다) */
function groupCursor(g: SyncGroup, states: Map<string, StateRow>): Date | null {
    let best: Date | null = null;
    for (const id of g.orgIds) {
        const c = toDate(states.get(id)?.update_cursor);
        if (c && (!best || c.getTime() > best.getTime())) best = c;
    }
    return best;
}

function groupField(g: SyncGroup, states: Map<string, StateRow>, field: "initial_from" | "initial_done_at"): Date | null {
    let best: Date | null = null;
    for (const id of g.orgIds) {
        const c = toDate(states.get(id)?.[field]);
        if (c && (!best || c.getTime() < best.getTime())) best = c;
    }
    return best;
}

// ============================================
// 묶음 하나
// ============================================

async function syncGroup(
    g: SyncGroup,
    states: Map<string, StateRow>,
    config: StatusSyncConfig,
    budget: CallBudget,
    fallbackLeft: { n: number },
    now: Date,
    trigger: "cron" | "manual"
): Promise<GroupResult> {
    const client = new NhnEmailClient(g.appKey, g.secretKey);
    const r: GroupResult = { calls: 0, windows: 0, updated: 0, finalized: 0, failedNew: 0, unpaired: 0, fallbackCalls: 0, errors: 0, skippedWindows: 0 };
    const callsBefore = budget.used;

    let cursor = groupCursor(g, states);
    let initialFrom = groupField(g, states, "initial_from");
    let initialDoneAt = groupField(g, states, "initial_done_at");
    if (!cursor) {
        cursor = initialCursor(now, config.backfillDays);
        initialFrom = cursor;
    }

    let failure: { kind: NhnFailureKind; status: number | null } | null = null;
    let consecutive = 0;

    // ① 커서 창을 예산 안에서 이어 읽는다
    while (budget.canCall()) {
        const win = nextUpdateWindow(cursor, now);
        if (!win) break;
        const read = await readWindow(client, win, config.pageSize, budget, now);
        if (!read.ok) {
            if (read.kind === "budget") break;
            if (read.kind === "rejected_window") {
                // NHN이 오래된 기간을 거절했다 — 그 창은 건너뛰고 커서를 넘긴다 (그 기간은 보조 질문이 48시간 안 것만 메운다)
                r.skippedWindows++;
                cursor = win.end;
                await saveCursor(g, cursor, initialFrom);
                continue;
            }
            r.errors++;
            consecutive++;
            failure = { kind: read.kind, status: read.status };
            if (read.kind === "auth" || consecutive >= MAX_CONSECUTIVE_ERRORS) break;
            continue;
        }
        consecutive = 0;
        failure = null;
        r.windows++;
        const applied = await applyUpdates(g, read.mails, client, budget);
        addApplied(r, applied);
        cursor = win.end;
        if (!initialDoneAt && isCursorCaughtUp(cursor, now)) initialDoneAt = now;
        // 창마다 커서를 남긴다 — 회차가 중간에 끊겨도 다음 회차가 여기서 잇는다
        await saveCursor(g, cursor, initialFrom, initialDoneAt);
    }
    if (!initialDoneAt && isCursorCaughtUp(cursor, now)) initialDoneAt = now;

    // ② 늦은 기록만 요청 번호로 묻기 (보조) — 키 오류면 하지 않는다
    if (!failure || failure.kind !== "auth") {
        for (const orgId of g.orgIds) {
            if (!budget.canCall() || fallbackLeft.n <= 0) break;
            const fb = await fallbackQueries(orgId, client, budget, fallbackLeft, now);
            addApplied(r, fb.applied);
            r.fallbackCalls += fb.calls;
            if (fb.failure) {
                r.errors++;
                failure = fb.failure;
                if (fb.failure.kind === "auth") break;
            }
        }
    }

    r.calls = budget.used - callsBefore;
    await saveState(g, {
        cursor,
        initialFrom,
        initialDoneAt,
        now,
        failure,
        consecutive,
        stats: { ...r, trigger, at: now.toISOString() },
    });
    if (failure) {
        console.warn(`[status-sync] 묶음 ${g.orgIds.length}개 조직: ${failureText(failure.kind, failure.status)} (errors=${r.errors})`);
    }
    return r;
}

function addApplied(r: GroupResult, a: { updated: number; finalized: number; failedNew: number; unpaired: number }) {
    r.updated += a.updated;
    r.finalized += a.finalized;
    r.failedNew += a.failedNew;
    r.unpaired += a.unpaired;
}

type ReadResult =
    | { ok: true; mails: NhnUpdatedMail[] }
    | { ok: false; kind: NhnFailureKind | "budget"; status: number | null };

/** 창 하나를 쪽 끝까지 읽는다. 예산이 모자라 끝까지 못 읽으면 budget — 커서를 옮기지 않는다 */
async function readWindow(
    client: NhnEmailClient,
    win: { start: Date; end: Date },
    pageSize: number,
    budget: CallBudget,
    now: Date
): Promise<ReadResult> {
    const mails: NhnUpdatedMail[] = [];
    for (let pageNum = 1; ; pageNum++) {
        if (!budget.canCall()) return { ok: false, kind: "budget", status: null };
        budget.use();
        let res: Awaited<ReturnType<NhnEmailClient["queryUpdatedMails"]>>;
        try {
            res = await client.queryUpdatedMails({
                startMailStatusUpdateDate: formatNhnDateTime(win.start),
                endMailStatusUpdateDate: formatNhnDateTime(win.end),
                pageNum,
                pageSize,
            });
        } catch {
            return { ok: false, kind: "transient", status: null };
        }
        if (!res.header?.isSuccessful) {
            const status = res.httpStatus >= 400 ? res.httpStatus : null;
            return { ok: false, kind: classifyNhnFailure(status, { updateWindow: true, windowStart: win.start, now }), status };
        }
        const page = res.data ?? [];
        mails.push(...page);
        if (page.length < pageSize || pageNum * pageSize >= res.totalCount) break;
    }
    return { ok: true, mails };
}

interface LogRef {
    id: number;
    org_id: string;
    request_id: string;
    recipient_email: string;
}

async function findLogsByRequestIds(orgIds: string[], requestIds: string[]): Promise<LogRef[]> {
    const out: LogRef[] = [];
    for (let i = 0; i < requestIds.length; i += IN_CHUNK) {
        const part = requestIds.slice(i, i + IN_CHUNK);
        const rows = (await db.execute(sql`
            SELECT id, org_id, request_id, recipient_email
            FROM email_send_logs
            WHERE request_id = ANY(${sql.param(part)}::text[]) AND org_id = ANY(${sql.param(orgIds)}::uuid[])
        `)) as unknown as LogRef[];
        out.push(...rows);
    }
    return out;
}

function toWrite(mail: { mailStatusCode: string; dsnCode?: string | null; dsnMessage?: string | null; resultDate?: string | null }): NhnStatusWrite | null {
    const w = mapNhnStatus(mail);
    if (!w) {
        const code = String(mail.mailStatusCode ?? "").slice(0, 12);
        if (!warnedCodes.has(code)) {
            warnedCodes.add(code);
            console.warn(`[status-sync] 모르는 NHN 상태 코드 "${code}" — 쓰지 않고 넘어감`);
        }
    }
    return w;
}

/** 창 하나의 결과를 짝짓고 조직마다 쓴다. 짝이 여럿인 요청 번호는 요청 번호 조회로 받는 주소를 맞춘다 */
async function applyUpdates(
    g: SyncGroup,
    mails: NhnUpdatedMail[],
    client: NhnEmailClient,
    budget: CallBudget
): Promise<{ updated: number; finalized: number; failedNew: number; unpaired: number }> {
    const total = { updated: 0, finalized: 0, failedNew: 0, unpaired: 0 };
    if (mails.length === 0) return total;
    const requestIds = [...new Set(mails.map((m) => String(m.requestId ?? "").trim()).filter(Boolean))];
    const logs = await findLogsByRequestIds(g.orgIds, requestIds);
    const orgOf = new Map(logs.map((l) => [l.id, l.org_id]));
    const paired = pairUpdatedMails(mails, logs.map((l) => ({ id: l.id, requestId: l.request_id })));
    total.unpaired += paired.unpaired;

    const writes: Array<{ logId: number; w: NhnStatusWrite }> = [];
    for (const p of paired.pairs) {
        const w = toWrite(p.mail);
        if (w) writes.push({ logId: p.logId, w });
    }

    // 짝이 여럿인 예외 — 받는 주소가 있는 요청 번호 조회로
    for (const rid of paired.multiRequestIds) {
        if (!budget.canCall()) break;
        budget.use();
        const rows = await queryByRequestId(client, rid);
        if (!rows.ok) continue;
        const ls = logs.filter((l) => l.request_id === rid).map((l) => ({ id: l.id, requestId: l.request_id, recipientEmail: l.recipient_email }));
        for (const p of pairNhnRows(rows.mails, ls)) {
            const w = toWrite(p.mail);
            if (w) writes.push({ logId: p.logId, w });
        }
    }

    const byOrg = new Map<string, Array<{ logId: number; w: NhnStatusWrite }>>();
    for (const x of writes) {
        const org = orgOf.get(x.logId);
        if (!org) continue;
        const list = byOrg.get(org) ?? [];
        list.push(x);
        byOrg.set(org, list);
    }
    for (const [orgId, list] of byOrg) {
        const a = await applyNhnStatuses(orgId, list);
        total.updated += a.updated;
        total.finalized += a.finalized;
        total.failedNew += a.failedNew;
    }
    return total;
}

async function queryByRequestId(
    client: NhnEmailClient,
    requestId: string
): Promise<{ ok: true; mails: NhnEmailQueryResult[] } | { ok: false; kind: NhnFailureKind; status: number | null }> {
    try {
        const res = await client.queryMails({ requestId, pageSize: 15 });
        if (!res.header?.isSuccessful) {
            const code = Number(res.header?.resultCode);
            const status = Number.isInteger(code) && code >= 400 && code < 600 ? code : null;
            return { ok: false, kind: classifyNhnFailure(status), status };
        }
        return { ok: true, mails: Array.isArray(res.data) ? res.data : [] };
    } catch {
        return { ok: false, kind: "transient", status: null };
    }
}

/**
 * 3-3 보조 질문: 커서로 못 받은 기록(2~48시간 지남, NHN 결과 없음, 3번 미만)을 요청 번호로 묻는다.
 * 반송 안내가 먼저 와서 failed가 된 기록(delivery_fail_source='dsn')도 묻는다 — NHN 코드를 받아야 판정 갈래가 정해진다 (SND-01 (a)).
 */
async function fallbackQueries(
    orgId: string,
    client: NhnEmailClient,
    budget: CallBudget,
    fallbackLeft: { n: number },
    now: Date
): Promise<{ calls: number; applied: { updated: number; finalized: number; failedNew: number; unpaired: number }; failure: { kind: NhnFailureKind; status: number | null } | null }> {
    const applied = { updated: 0, finalized: 0, failedNew: 0, unpaired: 0 };
    const limit = Math.min(fallbackLeft.n, budget.left());
    if (limit <= 0) return { calls: 0, applied, failure: null };
    const from = new Date(now.getTime() - FALLBACK_MAX_AGE_MS).toISOString();
    const to = new Date(now.getTime() - FALLBACK_MIN_AGE_MS).toISOString();
    const rows = (await db.execute(sql`
        SELECT id, request_id, recipient_email
        FROM email_send_logs
        WHERE org_id = ${orgId}::uuid
          AND request_id IS NOT NULL
          AND sent_at >= ${from}::timestamptz
          AND sent_at <= ${to}::timestamptz
          AND (status IN ('sent', 'pending') OR delivery_fail_source = 'dsn')
          AND (nhn_status_code IS NULL OR nhn_status_code IN ('SST0', 'SST1', 'SST4'))
          AND nhn_check_count < ${FALLBACK_MAX_CHECKS}
        ORDER BY sent_at, id
        LIMIT ${limit * 5}
    `)) as unknown as Array<{ id: number; request_id: string; recipient_email: string }>;
    const rids: string[] = [];
    for (const r of rows) {
        if (!rids.includes(r.request_id)) rids.push(r.request_id);
        if (rids.length >= limit) break;
    }
    let calls = 0;
    let failure: { kind: NhnFailureKind; status: number | null } | null = null;
    for (const rid of rids) {
        if (!budget.canCall() || fallbackLeft.n <= 0) break;
        budget.use();
        fallbackLeft.n--;
        calls++;
        // 물을 때마다 센다 — 3번 물어도 없으면 그만 (매일 보고의 미확정에 남는다)
        await db.execute(sql`
            UPDATE email_send_logs SET nhn_check_count = nhn_check_count + 1
            WHERE org_id = ${orgId}::uuid AND request_id = ${rid}
        `);
        const res = await queryByRequestId(client, rid);
        if (!res.ok) {
            failure = { kind: res.kind, status: res.status };
            if (res.kind === "auth") break;
            continue;
        }
        const ls = rows.filter((r) => r.request_id === rid).map((r) => ({ id: r.id, requestId: r.request_id, recipientEmail: r.recipient_email }));
        const writes: Array<{ logId: number; w: NhnStatusWrite }> = [];
        for (const p of pairNhnRows(res.mails, ls)) {
            const w = toWrite(p.mail);
            if (w) writes.push({ logId: p.logId, w });
        }
        const a = await applyNhnStatuses(orgId, writes);
        applied.updated += a.updated;
        applied.finalized += a.finalized;
        applied.failedNew += a.failedNew;
    }
    return { calls, applied, failure };
}

// ============================================
// 기록 쓰기 — 한 문장 (3-8)
// ============================================

/**
 * NHN 결과를 발송 기록에 쓴다. 커서·보조 질문·화면 버튼이 모두 이 문장을 쓴다 (반송 안내 보호가 같다 — SND-01 (c)).
 *   - 반송 안내(dsn)로 실패가 된 기록은 NHN이 SST2를 줘도 failed로 남는다
 *   - 확정 코드는 확정 코드로만 덮는다 (진행 중 코드가 늦게 와도 되돌리지 않는다)
 *   - SST3이면 실패 출처 nhn (먼저 온 쪽이 남는다)·실패 시각·DSN 상태·실패 쪽
 * 조직 조건을 꼭 단다 (PRD 6절). 200줄씩 묶어 쓴다.
 */
export async function applyNhnStatuses(
    orgId: string,
    writes: ReadonlyArray<{ logId: number; w: NhnStatusWrite }>
): Promise<{ updated: number; finalized: number; failedNew: number }> {
    const out = { updated: 0, finalized: 0, failedNew: 0 };
    // 같은 기록이 두 번 오면 마지막 것 (한 문장 안에서 같은 줄을 두 번 고칠 수 없다)
    const byLog = new Map<number, NhnStatusWrite>();
    for (const x of writes) byLog.set(x.logId, x.w);
    const rows = [...byLog.entries()].map(([id, w]) => ({
        id,
        code: w.code,
        log_status: w.logStatus,
        final: w.final,
        reason_code: w.reasonCode,
        reason_text: w.reasonText,
        result_at: w.resultAt ? w.resultAt.toISOString() : null,
        dsn_code: w.dsnCode,
        fail_side: w.failSide,
    }));
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const part = rows.slice(i, i + WRITE_CHUNK);
        const res = (await db.execute(sql`
            WITH v AS (
                SELECT * FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
                    AS v(id int, code text, log_status text, final boolean, reason_code text, reason_text text,
                         result_at timestamptz, dsn_code text, fail_side text)
            ),
            old AS (
                SELECT l.id, l.status AS old_status, l.nhn_status_code AS old_code
                FROM email_send_logs l JOIN v ON v.id = l.id
                WHERE l.org_id = ${orgId}::uuid
                FOR UPDATE OF l
            )
            UPDATE email_send_logs AS l SET
                nhn_status_code      = v.code,
                nhn_checked_at       = now(),
                status               = CASE WHEN v.log_status IS NULL OR l.delivery_fail_source = 'dsn' THEN l.status ELSE v.log_status END,
                result_code          = CASE WHEN v.code IN ('SST3','SST5','SST7','SST8') THEN v.reason_code ELSE l.result_code END,
                result_message       = CASE WHEN v.code IN ('SST3','SST5','SST7','SST8') THEN v.reason_text ELSE l.result_message END,
                completed_at         = CASE WHEN v.final THEN COALESCE(v.result_at, now()) ELSE l.completed_at END,
                delivery_status_code = CASE WHEN v.code = 'SST3' THEN COALESCE(v.dsn_code, l.delivery_status_code) ELSE l.delivery_status_code END,
                delivery_fail_side   = CASE WHEN v.code IN ('SST7','SST8') THEN 'sender'
                                            WHEN v.code = 'SST3' THEN v.fail_side
                                            ELSE l.delivery_fail_side END,
                delivery_fail_source = CASE WHEN v.code = 'SST3' THEN COALESCE(l.delivery_fail_source, 'nhn') ELSE l.delivery_fail_source END,
                delivery_failed_at   = CASE WHEN v.code = 'SST3' THEN COALESCE(l.delivery_failed_at, v.result_at, now()) ELSE l.delivery_failed_at END
            FROM v JOIN old ON old.id = v.id
            WHERE l.id = v.id AND l.org_id = ${orgId}::uuid
              AND (l.nhn_status_code IS NULL OR l.nhn_status_code IN ('SST0','SST1','SST4') OR v.final)
            RETURNING l.id, old.old_status, l.status AS new_status, old.old_code, l.nhn_status_code AS new_code
        `)) as unknown as Array<{ id: number; old_status: string; new_status: string; old_code: string | null; new_code: string | null }>;
        for (const r of res) {
            out.updated++;
            const wasFinal = r.old_code !== null && ["SST2", "SST3", "SST5", "SST7", "SST8"].includes(r.old_code);
            const isFinal = r.new_code !== null && ["SST2", "SST3", "SST5", "SST7", "SST8"].includes(r.new_code);
            if (!wasFinal && isFinal) out.finalized++;
            if (r.old_status !== "failed" && r.new_status === "failed") out.failedNew++;
        }
    }
    return out;
}

// ============================================
// 상태 줄
// ============================================

async function saveCursor(g: SyncGroup, cursor: Date, initialFrom: Date | null, initialDoneAt: Date | null = null): Promise<void> {
    for (const orgId of g.orgIds) {
        await db.execute(sql`
            INSERT INTO email_status_sync_state (org_id, update_cursor, initial_from, initial_done_at, updated_at)
            VALUES (${orgId}::uuid, ${cursor.toISOString()}::timestamptz,
                    ${initialFrom ? initialFrom.toISOString() : null}::timestamptz,
                    ${initialDoneAt ? initialDoneAt.toISOString() : null}::timestamptz, now())
            ON CONFLICT (org_id) DO UPDATE SET
                update_cursor = EXCLUDED.update_cursor,
                initial_from = COALESCE(email_status_sync_state.initial_from, EXCLUDED.initial_from),
                initial_done_at = COALESCE(email_status_sync_state.initial_done_at, EXCLUDED.initial_done_at),
                updated_at = now()
        `);
    }
}

async function saveState(
    g: SyncGroup,
    s: {
        cursor: Date;
        initialFrom: Date | null;
        initialDoneAt: Date | null;
        now: Date;
        failure: { kind: NhnFailureKind; status: number | null } | null;
        consecutive: number;
        stats: Record<string, unknown>;
    }
): Promise<void> {
    const ok = s.failure === null;
    const errorCode = s.failure ? (s.failure.kind === "rejected_window" ? "transient" : s.failure.kind) : null;
    const errorText = s.failure ? failureText(s.failure.kind, s.failure.status) : null;
    const nowIso = s.now.toISOString();
    const skipped = Number((s.stats as { skippedWindows?: unknown }).skippedWindows ?? 0) || 0;
    const insertStats = { ...s.stats, skippedWindowsTotal: skipped, skippedWindowsLastAt: skipped > 0 ? nowIso : null };
    for (const orgId of g.orgIds) {
        await db.execute(sql`
            INSERT INTO email_status_sync_state
                (org_id, update_cursor, initial_from, initial_done_at, last_run_at, last_ok_at, last_error, last_error_code,
                 consecutive_errors, stats, updated_at)
            VALUES (${orgId}::uuid, ${s.cursor.toISOString()}::timestamptz,
                    ${s.initialFrom ? s.initialFrom.toISOString() : null}::timestamptz,
                    ${s.initialDoneAt ? s.initialDoneAt.toISOString() : null}::timestamptz,
                    ${nowIso}::timestamptz, ${ok ? nowIso : null}::timestamptz, ${errorText}, ${errorCode},
                    ${ok ? 0 : s.consecutive}, ${JSON.stringify(insertStats)}::jsonb, now())
            ON CONFLICT (org_id) DO UPDATE SET
                update_cursor = EXCLUDED.update_cursor,
                initial_from = COALESCE(email_status_sync_state.initial_from, EXCLUDED.initial_from),
                initial_done_at = COALESCE(email_status_sync_state.initial_done_at, EXCLUDED.initial_done_at),
                last_run_at = EXCLUDED.last_run_at,
                last_ok_at = COALESCE(EXCLUDED.last_ok_at, email_status_sync_state.last_ok_at),
                last_error = EXCLUDED.last_error,
                last_error_code = EXCLUDED.last_error_code,
                consecutive_errors = CASE WHEN ${ok} THEN 0 ELSE email_status_sync_state.consecutive_errors + ${Math.max(1, s.consecutive)} END,
                -- NHN이 거절해 건너뛴 창은 누적으로 남긴다 (OPS-7 — 매일 보고·화면에 보인다. 마지막 회차 숫자만으로는 지나간다)
                stats = EXCLUDED.stats || jsonb_build_object(
                    'skippedWindowsTotal', COALESCE((email_status_sync_state.stats->>'skippedWindowsTotal')::int, 0) + ${skipped}::int,
                    'skippedWindowsLastAt', CASE WHEN ${skipped}::int > 0 THEN ${nowIso}::text
                                                 ELSE email_status_sync_state.stats->>'skippedWindowsLastAt' END
                ),
                updated_at = now()
        `);
    }
}
