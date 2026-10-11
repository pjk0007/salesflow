/**
 * 구글 챗 알림 전달 상태 (구글 챗 QA WPN-1~5) — DB.
 *
 * 깊이·회신·발송 건강·운영 알림은 모두 웹훅(받는 곳)으로 보낸다. 웹훅이 끊기면(401·403·404, 주소 없음·형식 오류,
 * 연결 실패가 이어짐) 알림이 조용히 쌓였다가 24시간 뒤 닫혔다 — 아무도 몰랐다. 그래서:
 *   - 보낼 때마다 결과를 받는 곳(웹훅을 정하는 환경 변수 이름)마다 chat_webhook_status에 남긴다 (recordChatWebhookResult)
 *   - 문제가 있으면 운영 스페이스에 6시간에 한 번, 고쳐지면 한 번 알린다 (notifyWebhookProblems). 받는 곳 순서는
 *     SEND_HEALTH_WEBHOOK_URL → REPLY_OPS_WEBHOOK_URL → DEEP_ALERT_WEBHOOK_URL(공통). 운영 웹훅 자체가 고장이면 다음 후보로 (WPN-3)
 *   - 매일 보고·발송 건강 화면이 이 표를 읽는다 (loadChatDeliveryProblems)
 * 주소·key·token은 어디에도 남기지 않는다 (환경 변수 이름과 한국어 오류 글만).
 * 이 표가 아직 없으면(0076 전) 조용히 건너뛴다 — 알림 보내기 자체를 막지 않는다.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatWebhookProblem, chatWebhookProblemText, postGoogleChatText, type GoogleChatResult } from "@/lib/google-chat";
import { formatKstShort } from "@/lib/kst";
import { chatSafe } from "@/lib/chat-text";
import { isProductionServer } from "@/lib/deep-visitor-alert-rules";
import { replyServerLabel } from "@/lib/email-reply-rules";

export type ChatProblemKind = "config" | "missing" | "invalid" | "unreachable";

const HOUR_MS = 60 * 60 * 1000;
/** 같은 문제는 운영 스페이스에 6시간에 한 번 */
export const WEBHOOK_NOTICE_INTERVAL_MS = 6 * HOUR_MS;
/** 연결 실패·5xx는 1시간 넘게 이어질 때만 알린다 (한 번의 일시 장애로 알리지 않게) */
export const UNREACHABLE_NOTICE_AFTER_MS = HOUR_MS;
/** 정상 기록은 받는 곳마다 10분에 한 번만 쓴다 (보낼 때마다 쓰지 않게) */
const OK_WRITE_INTERVAL_MS = 10 * 60 * 1000;
/** 알림 줄이 버려지기까지 (깊이·회신·건강 모두 24시간) */
const DROP_AFTER_MS = 24 * HOUR_MS;

export const OPS_NOTICE_SOURCES = ["SEND_HEALTH_WEBHOOK_URL", "REPLY_OPS_WEBHOOK_URL", "DEEP_ALERT_WEBHOOK_URL"] as const;

type Row = Record<string, unknown>;
type Env = Record<string, string | undefined>;

let tableMissingWarned = false;
const lastWrite = new Map<string, { kind: ChatProblemKind | null; at: number; urlHash?: string | null }>();
const lastClear = new Map<string, number>();

function isTableMissing(e: unknown): boolean {
    const code = (e as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (e as { cause?: { code?: unknown } } | null)?.cause?.code;
    return code === "42P01" || code === "42703";
}

function warnMissing(e: unknown): void {
    if (isTableMissing(e)) {
        if (!tableMissingWarned) {
            tableMissingWarned = true;
            console.warn("[chat-webhook] chat_webhook_status 표가 없음 (마이그레이션 0076 확인 필요) — 전달 상태를 남기지 않음");
        }
        return;
    }
    console.warn(`[chat-webhook] 전달 상태 기록 실패: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}`);
}

/**
 * 주소의 지문 (sha256 앞 16자). 주소(비밀값)는 남기지 않고, 고장 표시가 지금 주소의 것인지만 가린다 —
 * 웹훅을 새 주소로 바꿔 배포했는데 예전 주소의 고장 표시 때문에 1시간 동안 운영 알림을 보내지 않는 일이 없게
 */
export function webhookFingerprint(url: string | null | undefined): string | null {
    const u = (url ?? "").trim();
    if (!u) return null;
    return crypto.createHash("sha256").update(u).digest("hex").slice(0, 16);
}

/** 보내기 결과 → 웹훅 문제 갈래. null = 웹훅은 정상 (글 문제 400·한도 429는 웹훅 탓이 아니다) */
export function problemKindOf(result: GoogleChatResult): ChatProblemKind | null | "ok" {
    if (result.ok) return "ok";
    if (result.status === 401 || result.status === 403 || result.status === 404) return "config";
    // 주소 형식 오류는 보내지 않고 돌려준다 (다시 시도할 수 없는 연결 전 실패)
    if (result.status === null && !result.retryable) return "invalid";
    if (result.status === null || result.status >= 500) return "unreachable";
    return null;
}

/**
 * 보내기 결과를 남긴다. 실패해도 던지지 않는다 (알림 보내기를 막지 않게).
 * source = 웹훅을 정한 환경 변수 이름. workspaceId = 사업 스페이스면 그 워크스페이스
 */
export async function recordChatWebhookResult(
    source: string | null | undefined,
    workspaceId: number | null,
    result: GoogleChatResult,
    url?: string | null
): Promise<void> {
    if (!source) return;
    const kind = problemKindOf(result);
    if (kind === null) return;
    const urlHash = webhookFingerprint(url);
    if (kind === "ok") {
        const prev = lastWrite.get(source);
        if (prev && prev.kind === null && Date.now() - prev.at < OK_WRITE_INTERVAL_MS) return;
        try {
            await db.execute(sql`
                INSERT INTO chat_webhook_status (source, workspace_id, last_ok_at, url_hash, updated_at)
                VALUES (${source}, ${workspaceId}, now(), ${urlHash}, now())
                ON CONFLICT (source) DO UPDATE SET
                    last_ok_at = now(), kind = NULL, problem_since = NULL, workspace_id = EXCLUDED.workspace_id,
                    url_hash = COALESCE(EXCLUDED.url_hash, chat_webhook_status.url_hash), updated_at = now()
            `);
            lastWrite.set(source, { kind: null, at: Date.now() });
        } catch (e) {
            warnMissing(e);
        }
        return;
    }
    await recordProblem(source, workspaceId, kind, result.ok ? null : result.status, result.ok ? "" : result.error, urlHash);
}

/** 설정 문제(주소 없음·형식 오류)를 남긴다 — 회차 시작 때 허용 목록과 환경 변수를 맞춰 본 결과 */
export async function recordChatWebhookConfig(
    source: string,
    workspaceId: number | null,
    url: string | null | undefined
): Promise<void> {
    const problem = chatWebhookProblem(url);
    if (!problem) return;
    const kind: ChatProblemKind = problem === "missing" ? "missing" : "invalid";
    await recordProblem(source, workspaceId, kind, null, chatWebhookProblemText(problem), webhookFingerprint(url));
}

/**
 * 설정을 고쳐 주소가 맞으면(주소 없음·형식 오류였던 곳) 문제를 지운다 — 보낼 알림이 없어도 고쳐진 것으로 본다.
 * 운영 스페이스에는 "고쳐짐"이 한 번 간다 (알렸던 경우)
 */
export async function clearChatWebhookConfigProblem(source: string, workspaceId: number | null): Promise<void> {
    // 회차마다 쓰지 않게 따로 줄인다 — 보내기 결과 기록(lastWrite)과 섞으면, 401·403·404로 고장 난 받는 곳을 고친 뒤
    // 첫 성공 기록이 "이미 정상"으로 보고 건너뛰어 상태 표가 10분 동안 고장으로 남았다
    const at = lastClear.get(source);
    if (at !== undefined && Date.now() - at < OK_WRITE_INTERVAL_MS) return;
    try {
        const rows = (await db.execute(sql`
            UPDATE chat_webhook_status SET kind = NULL, problem_since = NULL, workspace_id = ${workspaceId}, updated_at = now()
            WHERE source = ${source} AND kind IN ('missing', 'invalid')
            RETURNING source
        `)) as unknown as Row[];
        lastClear.set(source, Date.now());
        if (rows.length > 0) lastWrite.delete(source);
    } catch (e) {
        warnMissing(e);
    }
}

async function recordProblem(
    source: string,
    workspaceId: number | null,
    kind: ChatProblemKind,
    status: number | null,
    error: string,
    urlHash: string | null
): Promise<void> {
    const prev = lastWrite.get(source);
    // 같은 문제를 회차마다 다시 쓰지 않는다 (마지막 실패 시각은 10분 단위면 충분하다)
    if (prev && prev.kind === kind && prev.urlHash === urlHash && Date.now() - prev.at < OK_WRITE_INTERVAL_MS && kind !== "config") return;
    try {
        await db.execute(sql`
            INSERT INTO chat_webhook_status (source, workspace_id, kind, last_status, last_error, problem_since, last_fail_at, url_hash, updated_at)
            VALUES (${source}, ${workspaceId}, ${kind}, ${status}, ${error.slice(0, 500)}, now(), now(), ${urlHash}, now())
            ON CONFLICT (source) DO UPDATE SET
                url_hash = EXCLUDED.url_hash,
                -- 같은 주소면 설정 문제가 연결 실패보다 앞선다. 주소를 바꿨으면(지문이 다르면) 예전 문제를 잇지 않는다
                kind = CASE WHEN EXCLUDED.kind = 'unreachable' AND chat_webhook_status.kind IN ('config', 'missing', 'invalid')
                                 AND chat_webhook_status.url_hash IS NOT DISTINCT FROM EXCLUDED.url_hash
                            THEN chat_webhook_status.kind ELSE EXCLUDED.kind END,
                last_status = EXCLUDED.last_status,
                last_error = EXCLUDED.last_error,
                problem_since = CASE WHEN chat_webhook_status.url_hash IS DISTINCT FROM EXCLUDED.url_hash THEN now()
                                     ELSE COALESCE(chat_webhook_status.problem_since, now()) END,
                last_fail_at = now(),
                workspace_id = EXCLUDED.workspace_id,
                updated_at = now()
        `);
        lastWrite.set(source, { kind, at: Date.now(), urlHash });
    } catch (e) {
        warnMissing(e);
    }
}

/**
 * 받는 곳(환경 변수 이름)이 지금 고장인가 (설정 오류·없음·형식 오류). 운영 알림이 고장 난 곳에 5분마다 다시 보내지 않게.
 * url을 주면 고장 난 주소와 지금 주소가 다를 때(새 주소로 고쳐 배포함) 고장이 아닌 것으로 본다
 */
export async function chatWebhookBroken(
    source: string,
    url?: string | null
): Promise<{ kind: ChatProblemKind; since: Date | null; lastFailAt: Date | null } | null> {
    try {
        const rows = (await db.execute(sql`
            SELECT kind, problem_since, last_fail_at, url_hash FROM chat_webhook_status WHERE source = ${source}
        `)) as unknown as Row[];
        const r = rows[0];
        if (!r || !r.kind) return null;
        const now = webhookFingerprint(url);
        if (now && r.url_hash && r.url_hash !== now) return null;
        return { kind: r.kind as ChatProblemKind, since: toDate(r.problem_since), lastFailAt: toDate(r.last_fail_at) };
    } catch (e) {
        warnMissing(e);
        return null;
    }
}

function toDate(v: unknown): Date | null {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isFinite(d.getTime()) ? d : null;
}

export interface ChatDeliveryProblem {
    source: string;
    workspaceId: number | null;
    workspaceName: string | null;
    kind: ChatProblemKind;
    lastStatus: number | null;
    lastError: string | null;
    problemSince: Date | null;
    lastOkAt: Date | null;
    /** 기다리는 알림 (깊이·회신·발송 건강) */
    waiting: { deep: number; reply: number; health: number };
    /** 가장 오래 기다린 알림이 들어온 때 (24시간이 지나면 버려진다) */
    oldestWaitingAt: Date | null;
}

/** 받는 곳 문제의 쉬운 말 (비개발자 대표·직원이 읽는다) */
export function problemKindText(kind: ChatProblemKind, status: number | null): string {
    if (kind === "config") {
        if (status === 404) return "스페이스에서 웹훅이 지워졌거나 주소가 틀렸습니다 (404)";
        if (status === 403) return "Workspace 관리자가 웹훅을 막았거나 권한이 없습니다 (403)";
        return "웹훅 주소의 열쇠(key·token)가 맞지 않습니다 (401)";
    }
    if (kind === "missing") return "웹훅 주소가 비어 있습니다";
    if (kind === "invalid") return "웹훅 주소 형식이 틀렸습니다 (구글 챗 주소가 아님)";
    return "구글 챗에 1시간 넘게 보내지 못했습니다 (연결 실패·시간 초과·구글 장애)";
}

function fixText(p: { source: string; kind: ChatProblemKind }): string {
    if (p.kind === "missing") return `할 일: 그 스페이스에서 웹훅을 만들어 환경 변수 ${p.source}에 넣고 배포해 주세요 (개발 담당에게 요청)`;
    if (p.kind === "invalid") return `할 일: 환경 변수 ${p.source}에 https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=… 꼴 주소를 넣고 배포해 주세요`;
    if (p.kind === "unreachable") return `할 일: 환경 변수 ${p.source} 주소의 호스트가 chat.googleapis.com인지 확인하고, 이어지면 개발 담당에게 알려 주세요`;
    return `할 일: 그 스페이스 관리자에게 새 웹훅 주소를 받아 환경 변수 ${p.source} 값을 바꾸고 배포해 주세요 (개발 담당에게 요청)`;
}

function targetLabel(p: { workspaceId: number | null; workspaceName: string | null; source: string }): string {
    if (p.workspaceId === null) return p.source === "DEEP_ALERT_WEBHOOK_URL" ? "공통 알림 스페이스" : "운영 스페이스";
    return `사업 스페이스 「${p.workspaceName ? chatSafe(p.workspaceName, { max: 40 }) : `워크스페이스 ${p.workspaceId}`}」`;
}

/**
 * 운영 알림 한 통 글 (6시간에 한 번 · 고쳐지면 한 번). 주소·key·token 없음.
 * serverLabel = 시험(개발) 서버면 "[개발 서버 · 호스트] " — 회신 운영 알림처럼 첫 줄 이모지 뒤에 붙인다 (구글 챗 QA N6).
 * 개발 서버가 운영과 같은 웹훅 변수를 쓰면 개발 서버의 웹훅 문제가 운영 스페이스로 가는데, 그때 어느 서버를 고칠지 알게
 */
export function webhookNoticeText(input: {
    now: Date;
    problems: ChatDeliveryProblem[];
    recovered: Array<{ source: string; workspaceId: number | null; workspaceName: string | null }>;
    baseUrl: string;
    serverLabel?: string;
}): string {
    const lines: string[] = [];
    if (input.problems.length > 0) {
        lines.push("⚠️ 샌드비 알림이 구글 챗 스페이스로 가지 못하고 있습니다");
        for (const p of input.problems.slice(0, 10)) {
            const waitingTotal = p.waiting.deep + p.waiting.reply + p.waiting.health;
            const parts = [
                p.waiting.deep ? `깊이 ${p.waiting.deep}` : "",
                p.waiting.reply ? `회신 ${p.waiting.reply}` : "",
                p.waiting.health ? `발송 건강 ${p.waiting.health}` : "",
            ].filter(Boolean);
            let wait = waitingTotal > 0 ? `기다리는 알림 ${waitingTotal}건 (${parts.join(" · ")})` : "기다리는 알림 없음";
            if (p.oldestWaitingAt) {
                const leftH = Math.max(0, Math.ceil((p.oldestWaitingAt.getTime() + DROP_AFTER_MS - input.now.getTime()) / HOUR_MS));
                wait += leftH > 0 ? ` — 고치지 않으면 가장 오래된 알림은 약 ${leftH}시간 뒤 버려집니다` : " — 오래된 알림부터 버려지고 있습니다";
            }
            lines.push(
                `• ${targetLabel(p)}: ${problemKindText(p.kind, p.lastStatus)}${p.problemSince ? ` · ${formatKstShort(p.problemSince)}부터` : ""}`,
                `  ${wait}`,
                `  ${fixText(p)}`
            );
        }
        if (input.problems.length > 10) lines.push(`외 ${input.problems.length - 10}곳`);
    }
    for (const r of input.recovered.slice(0, 10)) {
        lines.push(`✅ ${targetLabel(r)}: 웹훅이 고쳐져 다시 보냅니다`);
    }
    if (input.serverLabel && lines.length > 0) lines[0] = lines[0].replace(/^(⚠️ |✅ )?/, (m) => `${m}${input.serverLabel}`);
    lines.push(`알림 전달 상태: ${input.baseUrl.replace(/\/+$/, "")}/email#send-health`);
    return lines.join("\n");
}

/** 기다리는 알림 수 (받는 곳마다). 표가 없으면 0 */
async function waitingFor(p: { workspaceId: number | null; source: string }): Promise<{ deep: number; reply: number; health: number; oldest: Date | null }> {
    const out = { deep: 0, reply: 0, health: 0, oldest: null as Date | null };
    const take = (d: unknown) => {
        const at = toDate(d);
        if (at && (!out.oldest || at < out.oldest)) out.oldest = at;
    };
    const tryQ = async (query: ReturnType<typeof sql>): Promise<Row | null> => {
        try {
            const r = (await db.execute(query)) as unknown as Row[];
            return r[0] ?? null;
        } catch {
            return null;
        }
    };
    if (p.workspaceId !== null) {
        const ws = p.workspaceId;
        if (p.source.startsWith("DEEP_ALERT_WEBHOOK_URL")) {
            const d = await tryQ(sql`SELECT count(*)::int AS n, min(scheduled_at) AS oldest FROM deep_visitor_alerts WHERE workspace_id = ${ws}::int AND status = 'pending'`);
            out.deep = Number(d?.n ?? 0);
            take(d?.oldest);
            const r = await tryQ(sql`SELECT count(*)::int AS n, min(alert_next_at) AS oldest FROM email_replies WHERE workspace_id = ${ws}::int AND alert_status = 'pending'`);
            out.reply = Number(r?.n ?? 0);
            take(r?.oldest);
        }
        const h = await tryQ(sql`SELECT count(*)::int AS n, min(created_at) AS oldest FROM email_health_alerts WHERE target = ${`ws:${ws}`} AND status = 'pending'`);
        out.health = Number(h?.n ?? 0);
        take(h?.oldest);
    } else if (p.source === "SEND_HEALTH_WEBHOOK_URL") {
        const h = await tryQ(sql`SELECT count(*)::int AS n, min(created_at) AS oldest FROM email_health_alerts WHERE target = 'ops' AND status = 'pending'`);
        out.health = Number(h?.n ?? 0);
        take(h?.oldest);
    }
    return out;
}

async function workspaceNames(ids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (ids.length === 0) return out;
    try {
        const rows = (await db.execute(sql`SELECT id, name FROM workspaces WHERE id = ANY(${sql.param(ids)}::int[])`)) as unknown as Row[];
        for (const r of rows) out.set(Number(r.id), String(r.name ?? ""));
    } catch {
        // 이름 없이 번호로 쓴다
    }
    return out;
}

/**
 * 웹훅 문제를 운영 스페이스에 알린다 (6시간에 한 번, 원인이 바뀌면 바로, 고쳐지면 한 번). 회차마다 깊이·회신·발송 건강 워커가 부른다.
 * 줄을 먼저 차지하고(ops_alerted_at) 보낸다 — 여러 워커가 같이 불러도 한 통. 못 보내면 차지를 되돌린다 (다음 회차에 다시).
 * 던지지 않는다.
 */
export async function notifyWebhookProblems(opts: { env?: Env; now?: Date; post?: typeof postGoogleChatText } = {}): Promise<{ sent: boolean; problems: number; recovered: number }> {
    const env = opts.env ?? process.env;
    const now = opts.now ?? new Date();
    const post = opts.post ?? ((url: string, text: string) => postGoogleChatText(url, text));
    let claimed: Row[];
    try {
        claimed = (await db.execute(sql`
            WITH c AS (
                SELECT source, ops_alerted_at AS prev_at, ops_alerted_kind AS prev_kind
                FROM chat_webhook_status
                -- 지워진 워크스페이스의 줄은 알리지 않는다
                WHERE (workspace_id IS NULL OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = chat_webhook_status.workspace_id))
                  AND ((kind IS NOT NULL
                       AND (kind <> 'unreachable' OR problem_since < now() - (${UNREACHABLE_NOTICE_AFTER_MS}::bigint * INTERVAL '1 millisecond'))
                       AND (ops_alerted_at IS NULL
                            OR ops_alerted_at < now() - (${WEBHOOK_NOTICE_INTERVAL_MS}::bigint * INTERVAL '1 millisecond')
                            OR ops_alerted_kind IS DISTINCT FROM kind))
                   OR (kind IS NULL AND ops_alerted_at IS NOT NULL))
                FOR UPDATE SKIP LOCKED
            )
            UPDATE chat_webhook_status s
            SET ops_alerted_at = CASE WHEN s.kind IS NULL THEN NULL ELSE now() END, ops_alerted_kind = s.kind
            FROM c WHERE s.source = c.source
            RETURNING s.source, s.workspace_id, s.kind, s.last_status, s.last_error, s.problem_since, s.last_ok_at, c.prev_at, c.prev_kind
        `)) as unknown as Row[];
    } catch (e) {
        warnMissing(e);
        return { sent: false, problems: 0, recovered: 0 };
    }
    if (claimed.length === 0) return { sent: false, problems: 0, recovered: 0 };

    const names = await workspaceNames(claimed.map((r) => r.workspace_id).filter((x): x is number => x !== null && x !== undefined).map(Number));
    const problems: ChatDeliveryProblem[] = [];
    const recovered: Array<{ source: string; workspaceId: number | null; workspaceName: string | null }> = [];
    for (const r of claimed) {
        const workspaceId = r.workspace_id === null || r.workspace_id === undefined ? null : Number(r.workspace_id);
        const base = { source: String(r.source), workspaceId, workspaceName: workspaceId !== null ? names.get(workspaceId) ?? null : null };
        if (!r.kind) {
            recovered.push(base);
            continue;
        }
        const w = await waitingFor(base);
        problems.push({
            ...base,
            kind: r.kind as ChatProblemKind,
            lastStatus: r.last_status === null || r.last_status === undefined ? null : Number(r.last_status),
            lastError: (r.last_error as string | null) ?? null,
            problemSince: toDate(r.problem_since),
            lastOkAt: toDate(r.last_ok_at),
            waiting: { deep: w.deep, reply: w.reply, health: w.health },
            oldestWaitingAt: w.oldest,
        });
    }
    const baseUrl = ((env.NEXT_PUBLIC_BASE_URL ?? "").trim() || "https://sendb.kr").replace(/\/+$/, "");
    // 시험(개발) 서버면 첫 줄에 [개발 서버 · 호스트] (회신 운영 알림과 같은 판정·같은 표시, N6)
    const serverLabel = replyServerLabel({ serverKind: isProductionServer(env) ? "production" : "test", baseUrl });
    const text = webhookNoticeText({ now, problems, recovered, baseUrl, serverLabel });

    // 받는 곳: 고장 나지 않은 첫 운영 후보. 문제로 알리는 곳 자신은 쓰지 않는다
    const broken = new Set(problems.filter((p) => p.kind !== "unreachable").map((p) => p.source));
    let sent = false;
    for (const source of OPS_NOTICE_SOURCES) {
        const url = (env[source] ?? "").trim();
        if (!url || chatWebhookProblem(url) || broken.has(source)) continue;
        const known = await chatWebhookBroken(source, url);
        if (known && known.kind !== "unreachable") continue;
        let result: GoogleChatResult;
        try {
            result = await post(url, text);
        } catch (e) {
            result = { ok: false, status: null, error: e instanceof Error ? e.message : String(e), retryable: true };
        }
        await recordChatWebhookResult(source, null, result, url);
        if (result.ok || ("uncertain" in result && result.uncertain)) {
            sent = true;
            console.log(`[chat-webhook] 운영 알림 보냄 (${source}) 문제 ${problems.length} · 고쳐짐 ${recovered.length}`);
            break;
        }
        console.warn(`[chat-webhook] 운영 알림 실패 (${source}) status=${result.status ?? "-"} — 다음 후보로`);
    }
    if (!sent) {
        // 다음 회차에 다시 — 차지를 되돌린다 (고쳐진 줄도 다시 알리게 ops_alerted_at을 되살린다)
        for (const r of claimed) {
            try {
                await db.execute(sql`
                    UPDATE chat_webhook_status SET ops_alerted_at = ${toDate(r.prev_at)?.toISOString() ?? null}::timestamptz,
                           ops_alerted_kind = ${(r.prev_kind as string | null) ?? null}
                    WHERE source = ${String(r.source)}
                `);
            } catch (e) {
                warnMissing(e);
            }
        }
        if (problems.length > 0) console.warn(`[chat-webhook] 웹훅 문제 ${problems.length}곳을 알릴 운영 스페이스가 없음 — 발송 건강 화면에만 보임`);
    }
    return { sent, problems: problems.length, recovered: recovered.length };
}

/** 매일 보고·발송 건강 화면용: 지금 문제 있는 받는 곳 (조직의 워크스페이스와 운영). 표가 없으면 빈 목록 */
export async function loadChatDeliveryProblems(orgId: string | null): Promise<ChatDeliveryProblem[]> {
    let rows: Row[];
    try {
        rows = (await db.execute(sql`
            SELECT s.source, s.workspace_id, w.name AS workspace_name, s.kind, s.last_status, s.last_error, s.problem_since, s.last_ok_at
            FROM chat_webhook_status s LEFT JOIN workspaces w ON w.id = s.workspace_id
            WHERE s.kind IS NOT NULL
              ${orgId ? sql`AND (s.workspace_id IS NULL OR w.org_id = ${orgId}::uuid)` : sql``}
            ORDER BY s.problem_since NULLS LAST, s.source
        `)) as unknown as Row[];
    } catch (e) {
        warnMissing(e);
        return [];
    }
    const out: ChatDeliveryProblem[] = [];
    for (const r of rows) {
        const workspaceId = r.workspace_id === null || r.workspace_id === undefined ? null : Number(r.workspace_id);
        const w = await waitingFor({ workspaceId, source: String(r.source) });
        out.push({
            source: String(r.source),
            workspaceId,
            workspaceName: (r.workspace_name as string | null) ?? null,
            kind: r.kind as ChatProblemKind,
            lastStatus: r.last_status === null || r.last_status === undefined ? null : Number(r.last_status),
            lastError: (r.last_error as string | null) ?? null,
            problemSince: toDate(r.problem_since),
            lastOkAt: toDate(r.last_ok_at),
            waiting: { deep: w.deep, reply: w.reply, health: w.health },
            oldestWaitingAt: w.oldest,
        });
    }
    return out;
}

export interface ChatDeliveryStatusRow {
    source: string;
    workspaceId: number | null;
    workspaceName: string | null;
    /** 받는 곳 이름 (사업 스페이스 「이름」 / 운영 스페이스) */
    label: string;
    kind: ChatProblemKind | null;
    /** 문제의 쉬운 말 (정상이면 null) */
    problemText: string | null;
    lastStatus: number | null;
    lastError: string | null;
    problemSince: string | null;
    lastOkAt: string | null;
    lastFailAt: string | null;
    waiting: { deep: number; reply: number; health: number };
}

/** 발송 건강 화면의 "알림 전달" 칸 (WPN-5): 이 조직 워크스페이스와 운영 받는 곳마다 마지막 성공·지금 문제·기다리는 알림. 표가 없으면 빈 목록 */
export async function loadChatDeliveryStatus(orgId: string): Promise<ChatDeliveryStatusRow[]> {
    let rows: Row[];
    try {
        rows = (await db.execute(sql`
            SELECT s.source, s.workspace_id, w.name AS workspace_name, s.kind, s.last_status, s.last_error, s.problem_since,
                   s.last_ok_at, s.last_fail_at
            FROM chat_webhook_status s LEFT JOIN workspaces w ON w.id = s.workspace_id
            WHERE s.workspace_id IS NULL OR w.org_id = ${orgId}::uuid
            ORDER BY (s.kind IS NULL), s.workspace_id NULLS FIRST, s.source
            LIMIT 50
        `)) as unknown as Row[];
    } catch (e) {
        warnMissing(e);
        return [];
    }
    const iso = (v: unknown) => toDate(v)?.toISOString() ?? null;
    const out: ChatDeliveryStatusRow[] = [];
    for (const r of rows) {
        const workspaceId = r.workspace_id === null || r.workspace_id === undefined ? null : Number(r.workspace_id);
        const kind = (r.kind as ChatProblemKind | null) ?? null;
        const lastStatus = r.last_status === null || r.last_status === undefined ? null : Number(r.last_status);
        const base = { source: String(r.source), workspaceId, workspaceName: (r.workspace_name as string | null) ?? null };
        const w = kind ? await waitingFor(base) : { deep: 0, reply: 0, health: 0, oldest: null };
        out.push({
            ...base,
            label: targetLabel(base),
            kind,
            problemText: kind ? problemKindText(kind, lastStatus) : null,
            lastStatus,
            lastError: (r.last_error as string | null) ?? null,
            problemSince: iso(r.problem_since),
            lastOkAt: iso(r.last_ok_at),
            lastFailAt: iso(r.last_fail_at),
            waiting: { deep: w.deep, reply: w.reply, health: w.health },
        });
    }
    return out;
}

/** 매일 보고 한 줄 (WPN-4·HB-7). 문제도 못 보낸 알림도 없으면 null */
export function deliveryReportLine(problems: ChatDeliveryProblem[], failedYesterday: { deep: number; reply: number; health: number }): string | null {
    const total = failedYesterday.deep + failedYesterday.reply + failedYesterday.health;
    if (problems.length === 0 && total === 0) return null;
    const parts: string[] = [];
    if (total > 0) {
        const f = [
            failedYesterday.deep ? `깊이 ${failedYesterday.deep}` : "",
            failedYesterday.reply ? `회신 ${failedYesterday.reply}` : "",
            failedYesterday.health ? `발송 건강 ${failedYesterday.health}` : "",
        ].filter(Boolean);
        parts.push(`어제 못 보낸 알림 ${total}건 (${f.join(" · ")})`);
    }
    for (const p of problems.slice(0, 5)) {
        const waiting = p.waiting.deep + p.waiting.reply + p.waiting.health;
        parts.push(`${targetLabel(p)} ${problemKindText(p.kind, p.lastStatus)}${waiting > 0 ? ` (${waiting}건 기다림)` : ""}`);
    }
    return `알림 전달: ${parts.join(" · ")}`;
}
