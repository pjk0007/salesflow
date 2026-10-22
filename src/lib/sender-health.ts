import { acquireWorkerLock } from "./db/worker-lock";
/**
 * 발신 건강 회차 (SND-3) — DB. docs/2026-10-11-reply-and-health/DESIGN-SND.md 5~7절.
 *
 * runSendHealth (10분, 동기화보다 5분 어긋나게):
 *   동기화 건강 확인(관문·운영 알림) → 7일 묶음 집계(+ 느린 명단 30일, + 최근 1시간) → evaluateHealth(순수) → email_health_daily
 *   → planActions(순수) → 보류·멈춤 → 사건(email_health_events) → 알림 줄(조직·받는 곳마다 한 통, email_health_alerts)
 *   → 알림 보내기 → (09시 KST 뒤 첫 회차) 매일 보고
 * 잠금 0x5c4edf09, 예산 4분. SEND_HEALTH_MODE: off(아무것도 안 함) · dry_run(기록만, 챗 0통) · alert(알림만) · enforce(멈춤 + 알림).
 * email_send_logs 색인(8-3)이 아직 없으면 판정을 건너뛴다 (큰 표 전체를 훑지 않는다 — skipped: 'index_pending').
 * 알림 글·로그에 받는 사람 주소·이름·본문을 넣지 않는다 (명단 이름·우리 발신 주소·숫자·사유 코드 이름만).
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRequestIdEnabled, chatRequestIdFor, chatThreadsEnabled, postGoogleChatText, type ChatPostOptions, type GoogleChatResult } from "@/lib/google-chat";
import {
    isWebhookConfigError,
    POST_INTERVAL_MS,
    scrubWebhook,
    UNCERTAIN_GIVE_UP_NOTE,
    UNCERTAIN_MAX_ATTEMPTS,
    WEBHOOK_WAIT_PREFIX,
} from "@/lib/deep-visitor-alert-delivery";
import { deliveryReportLine, loadChatDeliveryProblems, notifyWebhookProblems, recordChatWebhookResult } from "@/lib/chat-webhook-status";
import { STALE_AFTER_MS } from "@/lib/deep-visitor-alert-rules";
import { SEND_LOG_INDEXES_READY_SQL } from "@/lib/db/send-log-indexes";
import { linkSenderPool } from "@/lib/email-sender-limit-rules";
import { addDaysYmd } from "@/lib/kst";
import { resolveReplyConfig, describeReplyError } from "@/lib/email-reply-rules";
import { countHeldQueue, holdPartition, pauseSenderForHealth } from "@/lib/partition-hold";
import {
    DEFAULT_THRESHOLDS,
    HEALTH_CATEGORY_SQL,
    authBurstText,
    batchAlertText,
    capText,
    dailyReportText,
    dangerEpisodeStart,
    dedupeKey,
    evaluateHealth,
    formatRate,
    hasReportableItems,
    healthThreadKey,
    healthWebhookInfo,
    holdReasonText,
    isQuietHour,
    isReportDue,
    kstDayStart,
    kstYesterdayRange,
    mergeSyncAlertTexts,
    partitionDangerText,
    planActions,
    releaseText,
    resolveSendHealthConfig,
    senderDangerText,
    senderWithPartitionsText,
    syncAlertText,
    syncGate,
} from "@/lib/sender-health-rules";
import type {
    BurstRow,
    FailReason,
    HealthBucket,
    HealthEvaluation,
    HealthPartitionInfo,
    HealthSenderInfo,
    PlannedEvent,
    SendHealthConfig,
    SendHealthMode,
    SlowRow,
    SyncStateLike,
} from "@/lib/sender-health-rules";

export const SEND_HEALTH_LOCK_KEY = 0x5c4edf09;
const TIME_BUDGET_MS = 4 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STUCK_ALERT_MS = 15 * 60 * 1000;
const ALERT_RETRY_MS = 10 * 60 * 1000;
const ALERT_MAX_ATTEMPTS = 3;
const ALERT_PICK = 20;
const NIGHT_SKIP = "밤 시간 — 09시 매일 보고에 실음";
const STALE_ALERT_ERROR = "오래되어 보내지 않음 (만든 지 24시간 지남)";
const NO_WEBHOOK = "웹훅 주소 없음";
const STUCK_ALERT_ERROR = "처리 중 멈춤 — 되돌림";
const SUPERSEDED = "새 알림으로 대신함";
/** NHN 결과 확인 알림: 같은 원인은 마지막 알림 6시간 뒤 (HS-6) */
const SYNC_REPEAT_MS = 6 * HOUR_MS;
/** sent 기록이 일시 DB 오류로 실패하면 짧게 다시 — 이미 올라간 글이 15분 뒤 다시 나가지 않게 (HB-3) */
const MARK_SENT_TRIES = 3;
const MARK_SENT_RETRY_MS = 300;

export interface SendHealthStats {
    mode: SendHealthMode;
    orgs: number;
    danger: number;
    caution: number;
    holds: number;
    pauses: number;
    authBursts: number;
    gated: number;
    events: number;
    alertsSent: number;
    alertsFailed: number;
    report: number;
    skipped?: "off" | "index_pending" | "no_orgs";
    skippedAsLocked?: boolean;
    deadlineHit?: boolean;
}

export interface SendHealthOptions {
    now?: Date;
    env?: Record<string, string | undefined>;
    /** 시험: 알림 보내기를 건너뛴다 (줄만 남긴다) */
    skipDelivery?: boolean;
}

type Row = Record<string, unknown>;

async function q<T = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
    return (await db.execute(query)) as unknown as T[];
}

function toDate(v: unknown): Date | null {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isFinite(d.getTime()) ? d : null;
}

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function shortError(e: unknown): string {
    return describeReplyError(e);
}

/**
 * Postgres 배열 글자 ('{1,2}' · '{"2026-…Z"}'). 빈 배열도 넘길 수 있게 쓴다 — 드라이버는 빈 배열의 형을 몰라 매개변수로 못 넘긴다.
 * 숫자와 ISO 시각만 넣는다 (따옴표·역슬래시가 없는 값).
 */
function pgArrayLiteral(values: ReadonlyArray<number | string>): string {
    return `{${values.map((v) => (typeof v === "number" ? String(v) : `"${String(v).replace(/["\\]/g, "")}"`)).join(",")}}`;
}

// ============================================
// 진입점
// ============================================

export async function runSendHealth(opts: SendHealthOptions = {}): Promise<SendHealthStats> {
    const env = opts.env ?? process.env;
    const config = resolveSendHealthConfig(env);
    const stats: SendHealthStats = {
        mode: config.mode,
        orgs: 0,
        danger: 0,
        caution: 0,
        holds: 0,
        pauses: 0,
        authBursts: 0,
        gated: 0,
        events: 0,
        alertsSent: 0,
        alertsFailed: 0,
        report: 0,
    };
    if (config.mode === "off") return { ...stats, skipped: "off" };

    const workerLock = await acquireWorkerLock(SEND_HEALTH_LOCK_KEY);
    try {
        if (!workerLock) {
            console.log("[send-health] 다른 회차가 도는 중 — 건너뜀");
            return { ...stats, skippedAsLocked: true };
        }
        const now = opts.now ?? new Date();
        const runStartedMs = Date.now();
        const deadline = runStartedMs + TIME_BUDGET_MS;

        const ready = await q<{ ready: number }>(sql.raw(SEND_LOG_INDEXES_READY_SQL));
        if (num(ready[0]?.ready) < 2) {
            console.log("[send-health] email_send_logs 색인을 만드는 중 — 이번 회차 판정을 건너뜀");
            stats.skipped = "index_pending";
        } else {
            const scope = await resolveSendHealthOrgScope(config);
            const orgs = await q<{ org_id: string; name: string }>(sql`
                SELECT c.org_id, o.name
                FROM email_configs c JOIN organizations o ON o.id = c.org_id
                WHERE c.is_active = 1
                  ${scope === "all" ? sql`` : sql`AND c.org_id = ANY(${sql.param(scope.length > 0 ? scope : ["00000000-0000-0000-0000-000000000000"])}::uuid[])`}
                GROUP BY c.org_id, o.name
                ORDER BY c.org_id
            `);
            if (orgs.length === 0) {
                console.log("[send-health] 판정할 조직 없음 (SEND_HEALTH_ORG_IDS·REPLY_WORKSPACE_IDS·DEEP_ALERT_WORKSPACE_IDS 확인)");
                stats.skipped = "no_orgs";
            }
            for (const org of orgs) {
                if (Date.now() > deadline) {
                    stats.deadlineHit = true;
                    break;
                }
                try {
                    await runOrg(org.org_id, org.name, config, env, now, stats, runStartedMs);
                    stats.orgs++;
                } catch (e) {
                    console.error(`[send-health] 조직 ${org.org_id} 판정 실패: ${shortError(e)}`);
                }
            }
        }

        if (!opts.skipDelivery) {
            const d = await deliverHealthAlerts({ env, deadline });
            stats.alertsSent += d.sent;
            stats.alertsFailed += d.failed;
            // 웹훅 문제(설정 오류·없음·연결 실패가 이어짐)를 운영 스페이스에 알린다 — 6시간에 한 번, 고쳐지면 한 번 (WPN-1)
            if (config.mode === "alert" || config.mode === "enforce") await notifyWebhookProblems({ env }).catch(() => {});
        }
        console.log(
            `[send-health] mode=${stats.mode} orgs=${stats.orgs} danger=${stats.danger} caution=${stats.caution} holds=${stats.holds} ` +
            `pauses=${stats.pauses} authBursts=${stats.authBursts} gated=${stats.gated} events=${stats.events} ` +
            `alertsSent=${stats.alertsSent} alertsFailed=${stats.alertsFailed} report=${stats.report}${stats.skipped ? ` skipped=${stats.skipped}` : ""}`
        );
        return stats;
    } finally {
        await workerLock?.release();
    }
}

/**
 * 판정·조치할 조직 (OPS-2): "all" 또는 조직 id 목록. 기본은 회신 읽기·깊이 알림 워크스페이스의 조직(우리 조직)만 —
 * 다른 고객사 명단을 보류하거나 그 명단 이름·발신 주소가 우리 운영 스페이스로 가지 않게. 모든 조직은 SEND_HEALTH_ORG_IDS=*
 */
export async function resolveSendHealthOrgScope(config: SendHealthConfig): Promise<"all" | string[]> {
    const scope = config.orgScope;
    if (scope.kind === "all") return "all";
    if (scope.kind === "ids") return scope.orgIds;
    if (scope.workspaceIds.length === 0) return [];
    const rows = await q<{ org_id: string }>(sql`
        SELECT DISTINCT org_id FROM workspaces WHERE id = ANY(${sql.param(scope.workspaceIds)}::int[])
    `);
    return rows.map((r) => String(r.org_id));
}

// ============================================
// 조직 하나
// ============================================

interface OrgContext {
    orgId: string;
    orgName: string;
    config: SendHealthConfig;
    env: Record<string, string | undefined>;
    now: Date;
    workspaceNames: Map<number, string>;
    partitionNames: Map<number, string>;
    partitionWorkspace: Map<number, number>;
    senders: HealthSenderInfo[];
    /** 이번 회차에 보류를 건 명단 */
    heldNow: Set<number>;
    /** 이번 회차에 자동으로 멈춘 주소 (매일 보고가 조치 뒤 상태를 보게, HD-05) */
    pausedNow: Set<number>;
    /** 회차를 실제로 시작한 시각 (묶음 알림 키 run:<ms> — 시험이 넘긴 now와 상관없이 회차마다 다르다) */
    runStartedMs: number;
}

async function runOrg(
    orgId: string,
    orgName: string,
    config: SendHealthConfig,
    env: Record<string, string | undefined>,
    now: Date,
    stats: SendHealthStats,
    runStartedMs: number
): Promise<void> {
    const t = DEFAULT_THRESHOLDS;
    const ctx: OrgContext = {
        orgId,
        orgName,
        config,
        env,
        now,
        workspaceNames: new Map(),
        partitionNames: new Map(),
        partitionWorkspace: new Map(),
        senders: [],
        heldNow: new Set(),
        pausedNow: new Set(),
        runStartedMs,
    };

    // ── 이름표 ──
    const parts = await q<{ id: number; name: string; workspace_id: number; workspace_name: string }>(sql`
        SELECT p.id, p.name, p.workspace_id, w.name AS workspace_name
        FROM partitions p JOIN workspaces w ON w.id = p.workspace_id
        WHERE w.org_id = ${orgId}::uuid
    `);
    for (const p of parts) {
        ctx.partitionNames.set(num(p.id), p.name);
        ctx.partitionWorkspace.set(num(p.id), num(p.workspace_id));
        ctx.workspaceNames.set(num(p.workspace_id), p.workspace_name);
    }
    const profiles = await q<Row>(sql`
        SELECT id, from_email, is_default, is_paused, paused_source, paused_at, health_action, health_reset_at
        FROM email_sender_profiles WHERE org_id = ${orgId}::uuid ORDER BY id
    `);
    ctx.senders = profiles.map((p) => {
        const email = String(p.from_email ?? "").trim().toLowerCase();
        return {
            id: num(p.id),
            email,
            domain: email.includes("@") ? email.split("@")[1] : "",
            isDefault: p.is_default === true,
            isPaused: p.is_paused === true,
            pausedSource: (p.paused_source as string | null) ?? null,
            healthAction: String(p.health_action ?? "auto"),
            floorAt: toDate(p.health_reset_at),
        };
    });

    // ── ① 동기화 건강 (6-1) ──
    const syncRows = await q<Row>(sql`
        SELECT last_ok_at, last_error, last_error_code, initial_done_at, update_cursor, ops_alerted_at, ops_alerted_cause, stats
        FROM email_status_sync_state WHERE org_id = ${orgId}::uuid
    `);
    const syncRow = syncRows[0] ?? null;
    const syncState: SyncStateLike | null = syncRow
        ? { lastOkAt: toDate(syncRow.last_ok_at), lastErrorCode: (syncRow.last_error_code as string | null) ?? null, initialDoneAt: toDate(syncRow.initial_done_at) }
        : null;
    const gate = syncGate(syncState, now, t);
    await syncAlerts(ctx, syncRow, gate, stats);

    // ── ② 보류 이력 → 명단 재판정 하한·보류 중·최근 7일 보류/풀림 ──
    const holdRows = await q<Row>(sql`
        SELECT partition_id,
               max(released_at) AS last_released,
               max(id) FILTER (WHERE released_at IS NULL) AS active_id,
               bool_or(held_at >= ${new Date(now.getTime() - 7 * DAY_MS).toISOString()}::timestamptz
                       OR released_at >= ${new Date(now.getTime() - 7 * DAY_MS).toISOString()}::timestamptz) AS recent
        FROM email_partition_holds WHERE org_id = ${orgId}::uuid
        GROUP BY partition_id
    `);
    const holdInfo = new Map<number, { floorAt: Date | null; activeId: number | null; recent: boolean }>();
    for (const h of holdRows) {
        holdInfo.set(num(h.partition_id), {
            floorAt: toDate(h.last_released),
            activeId: h.active_id === null || h.active_id === undefined ? null : num(h.active_id),
            recent: h.recent === true,
        });
    }

    // ── ③ 7일 묶음 (6-0 ①) ──
    const pFloors = [...holdInfo.entries()].filter(([, h]) => h.floorAt).map(([pid, h]) => ({ id: pid, at: h.floorAt!.toISOString() }));
    const sFloors = ctx.senders.filter((s) => s.floorAt).map((s) => ({ id: s.id, at: s.floorAt!.toISOString() }));
    const since7 = new Date(now.getTime() - t.windowMs).toISOString();
    const nowIso = now.toISOString();
    const bucketRows = await q<Row>(sql`
        WITH pf AS (SELECT * FROM unnest(${pgArrayLiteral(pFloors.map((x) => x.id))}::int[], ${pgArrayLiteral(pFloors.map((x) => x.at))}::timestamptz[]) AS t(pid, floor_at)),
             sf AS (SELECT * FROM unnest(${pgArrayLiteral(sFloors.map((x) => x.id))}::int[], ${pgArrayLiteral(sFloors.map((x) => x.at))}::timestamptz[]) AS t(sid, floor_at)),
             x AS (
                SELECT l.partition_id, l.sender_profile_id,
                       lower(split_part(COALESCE(l.sender_email, ''), '@', 2)) AS sender_domain,
                       date_trunc('hour', l.sent_at) AS hour_start,
                       l.sent_at >= COALESCE(pf.floor_at, '-infinity'::timestamptz) AS after_p,
                       l.sent_at >= COALESCE(sf.floor_at, '-infinity'::timestamptz) AS after_s,
                       ${sql.raw(HEALTH_CATEGORY_SQL)} AS cat
                FROM email_send_logs l
                LEFT JOIN pf ON pf.pid = l.partition_id
                LEFT JOIN sf ON sf.sid = l.sender_profile_id
                WHERE l.org_id = ${orgId}::uuid AND l.sent_at >= ${since7}::timestamptz AND l.sent_at < ${nowIso}::timestamptz
                  AND COALESCE(l.trigger_type, '') NOT LIKE 'test%'
             )
        SELECT partition_id, sender_profile_id, sender_domain, hour_start, after_p, after_s,
               count(*) FILTER (WHERE cat = 'success')::int AS success,
               count(*) FILTER (WHERE cat = 'failed')::int AS failed,
               count(*) FILTER (WHERE cat = 'dsn_only')::int AS dsn_only,
               count(*) FILTER (WHERE cat = 'sender_side')::int AS sender_side,
               count(*) FILTER (WHERE cat = 'nhn_unsub')::int AS nhn_unsub,
               count(*) FILTER (WHERE cat = 'unknown')::int AS unknown
        FROM x
        GROUP BY 1, 2, 3, 4, 5, 6
    `);
    const buckets: HealthBucket[] = bucketRows.map((r) => ({
        partitionId: r.partition_id === null ? null : num(r.partition_id),
        senderProfileId: r.sender_profile_id === null ? null : num(r.sender_profile_id),
        senderDomain: String(r.sender_domain ?? ""),
        hourStart: toDate(r.hour_start) ?? now,
        afterP: r.after_p === true,
        afterS: r.after_s === true,
        success: num(r.success),
        failed: num(r.failed),
        dsnOnly: num(r.dsn_only),
        senderSide: num(r.sender_side),
        nhnUnsub: num(r.nhn_unsub),
        unknown: num(r.unknown),
    }));

    // ── ④ 느린 명단 30일 (6-0 ②) — 7일 확정이 200 미만인 명단만 ──
    const final7 = new Map<number, number>();
    for (const b of buckets) {
        if (b.partitionId === null || !b.afterP) continue;
        final7.set(b.partitionId, (final7.get(b.partitionId) ?? 0) + b.success + b.failed + (config.dsnInRate ? b.dsnOnly : 0));
    }
    const slowIds = [...final7.entries()].filter(([, f]) => f < t.partitionMinFinal).map(([id]) => id);
    let slow: SlowRow[] = [];
    if (slowIds.length > 0) {
        const since30 = new Date(now.getTime() - t.slowWindowMs).toISOString();
        const slowRows = await q<Row>(sql`
            WITH pf AS (SELECT * FROM unnest(${pgArrayLiteral(pFloors.map((x) => x.id))}::int[], ${pgArrayLiteral(pFloors.map((x) => x.at))}::timestamptz[]) AS t(pid, floor_at)),
                 x AS (
                    SELECT l.partition_id, l.sent_at,
                           l.sent_at >= COALESCE(pf.floor_at, '-infinity'::timestamptz) AS after_p,
                           ${sql.raw(HEALTH_CATEGORY_SQL)} AS cat
                    FROM email_send_logs l LEFT JOIN pf ON pf.pid = l.partition_id
                    WHERE l.org_id = ${orgId}::uuid AND l.partition_id = ANY(${sql.param(slowIds)}::int[])
                      AND l.sent_at >= ${since30}::timestamptz AND l.sent_at < ${nowIso}::timestamptz
                      AND COALESCE(l.trigger_type, '') NOT LIKE 'test%'
                 )
            SELECT partition_id, after_p, min(sent_at) AS first_sent_at,
                   count(*) FILTER (WHERE cat = 'success')::int AS success,
                   count(*) FILTER (WHERE cat = 'failed')::int AS failed,
                   count(*) FILTER (WHERE cat = 'dsn_only')::int AS dsn_only
            FROM x GROUP BY 1, 2
        `);
        slow = slowRows.map((r) => ({
            partitionId: num(r.partition_id),
            afterP: r.after_p === true,
            firstSentAt: toDate(r.first_sent_at),
            success: num(r.success),
            failed: num(r.failed),
            dsnOnly: num(r.dsn_only),
        }));
    }

    // ── ⑤ 최근 1시간 발신 쪽 실패 (6-0 ③) ──
    const since1h = new Date(now.getTime() - t.authBurstWindowMs).toISOString();
    const burstRows = await q<Row>(sql`
        WITH x AS (
            SELECT lower(split_part(COALESCE(l.sender_email, ''), '@', 2)) AS sender_domain, l.sender_profile_id,
                   ${sql.raw(HEALTH_CATEGORY_SQL)} AS cat
            FROM email_send_logs l
            WHERE l.org_id = ${orgId}::uuid AND l.sent_at >= ${since1h}::timestamptz AND l.sent_at < ${nowIso}::timestamptz
              AND COALESCE(l.trigger_type, '') NOT LIKE 'test%'
        )
        SELECT sender_domain, sender_profile_id,
               count(*) FILTER (WHERE cat = 'success')::int AS success,
               count(*) FILTER (WHERE cat = 'failed')::int AS failed,
               count(*) FILTER (WHERE cat = 'dsn_only')::int AS dsn_only,
               count(*) FILTER (WHERE cat = 'sender_side')::int AS sender_side,
               count(*) FILTER (WHERE cat = 'nhn_unsub')::int AS nhn_unsub,
               count(*) FILTER (WHERE cat = 'unknown')::int AS unknown
        FROM x GROUP BY 1, 2
    `);
    const burst: BurstRow[] = burstRows.map((r) => ({
        senderDomain: String(r.sender_domain ?? ""),
        senderProfileId: r.sender_profile_id === null ? null : num(r.sender_profile_id),
        success: num(r.success),
        failed: num(r.failed),
        dsnOnly: num(r.dsn_only),
        senderSide: num(r.sender_side),
        nhnUnsub: num(r.nhn_unsub),
        unknown: num(r.unknown),
    }));

    // ── ⑥ 회복 재료: 지난 7일 주의·위험 ──
    const badRows = await q<{ entity_key: string }>(sql`
        SELECT DISTINCT entity_key FROM email_health_daily
        WHERE org_id = ${orgId}::uuid AND state IN ('caution', 'danger')
          AND evaluated_at >= ${new Date(now.getTime() - 7 * DAY_MS).toISOString()}::timestamptz
          AND health_date < ${kstDayStart(now).date}
    `);
    const recentlyBad = new Set(badRows.map((r) => r.entity_key));

    // ── ⑦ 판정 ──
    const partitionIds = new Set<number>([...buckets.map((b) => b.partitionId).filter((x): x is number => x !== null), ...holdInfo.keys()]);
    const partitions: HealthPartitionInfo[] = [...partitionIds].map((id) => {
        const h = holdInfo.get(id);
        return {
            id,
            workspaceId: ctx.partitionWorkspace.get(id) ?? 0,
            name: ctx.partitionNames.get(id) ?? `명단 ${id}`,
            floorAt: h?.floorAt ?? null,
            activeHoldId: h?.activeId ?? null,
            heldOrReleasedRecently: h?.recent ?? false,
            alertOnly: config.alertOnlyPartitionIds.includes(id),
        };
    });
    const evaluation = evaluateHealth({
        now,
        dsnInRate: config.dsnInRate,
        buckets,
        slow,
        burst,
        partitions,
        senders: ctx.senders,
        recentlyBad,
    });
    stats.danger +=
        evaluation.partitions.filter((p) => p.state === "danger").length +
        evaluation.senders.filter((s) => s.state === "danger").length +
        evaluation.domains.filter((d) => d.state === "danger").length;
    stats.caution +=
        evaluation.partitions.filter((p) => p.state === "caution").length +
        evaluation.senders.filter((s) => s.state === "caution").length +
        evaluation.domains.filter((d) => d.state === "caution").length;
    // 위험 구간 (F7·OPS-4): 하루 건강의 지난 줄(덮어쓰기 전)로 구간 시작을 정하고 그 값을 오늘 줄에 이어 적는다
    const episodes = await loadDangerEpisodes(ctx, evaluation);
    await writeDaily(ctx, evaluation, episodes);

    // ── ⑧ 조치 계획 (상한은 오늘 KST 기준) ──
    const day = kstDayStart(now);
    const capRows = await q<Row>(sql`
        SELECT
          count(*) FILTER (WHERE kind = 'danger' AND entity_type = 'sender' AND action = 'pause')::int AS sender_pauses,
          count(DISTINCT entity_key) FILTER (WHERE kind = 'auth_burst' AND action = 'pause')::int AS auth_domains
        FROM email_health_events
        WHERE org_id = ${orgId}::uuid AND created_at >= ${day.start.toISOString()}::timestamptz
    `);
    const plan = planActions({
        mode: config.mode,
        now,
        evaluation,
        senders: ctx.senders,
        gate,
        autoPauseLeft: config.maxAutoPausePerDay - num(capRows[0]?.sender_pauses),
        authDomainsLeft: config.maxAuthPauseDomainsPerDay - num(capRows[0]?.auth_domains),
        episodes: { partitions: episodes.dangerStart.partitions, senders: episodes.dangerStart.senders },
        existingDangerKeys: await loadDangerKeys(orgId, now),
    });

    // ── ⑨ 실행 + 사건 ──
    const toAlert: AlertItem[] = [];
    for (const ev of plan.events) {
        if (ev.actionNote === "sync_stale" || ev.actionNote === "sync_initial" || ev.actionNote === "unconfirmed_high") stats.gated++;
        if (ev.kind === "auth_burst") stats.authBursts++;
        const done = await executeEvent(ctx, ev, evaluation, stats);
        if (done) toAlert.push(done);
    }
    // 상한 걸림 (한 덩어리 — 주소 상한 cap, 도메인 상한 cap_auth)
    const capItems = [
        {
            key: dedupeKey.cap(now),
            note: "cap" as const,
            list: plan.cappedSenders.map((id) => ctx.senders.find((s) => s.id === id)?.email ?? `주소 ${id}`),
            domains: [] as string[],
        },
        { key: dedupeKey.capAuth(now), note: "cap_auth" as const, list: [] as string[], domains: plan.cappedDomains },
    ];
    for (const c of capItems) {
        if (c.list.length === 0 && c.domains.length === 0) continue;
        const text = capText({
            senderEmails: c.list,
            domains: c.domains,
            maxPause: config.maxAutoPausePerDay,
            maxDomains: config.maxAuthPauseDomainsPerDay,
        });
        const key = c.key;
        const ins = await insertEvent(ctx, {
            workspaceId: null,
            entityType: "org",
            entityId: null,
            entityKey: null,
            kind: "cap",
            level: "danger",
            action: "none",
            actionNote: c.note,
            evalWindow: null,
            dedupeKey: key,
            metrics: { items: [...c.list, ...c.domains] },
            summary: text,
        });
        if (ins.isNew) {
            stats.events++;
            toAlert.push({
                ev: {
                    kind: "danger",
                    entityType: "sender",
                    entityId: null,
                    entityKey: null,
                    workspaceIds: [],
                    dedupeKey: key,
                    action: "none",
                    actionNote: "cap",
                    wouldAction: null,
                    evalWindow: null,
                    pauseProfileIds: [],
                    skippedProfileIds: [],
                    urgent: true,
                },
                id: ins.id,
                text,
            });
        }
    }

    // ── ⑩ 알림 줄 (조직·받는 곳마다 한 통) ──
    if (toAlert.length > 0) await queueBatchAlerts(ctx, `run:${ctx.runStartedMs}`, toAlert);

    // ── ⑪ 매일 보고 ──
    if (isReportDue(now, config.reportHour)) {
        // 이번 회차에 건 보류·멈춤을 판정에 반영해 보고한다 — 방금 보류한 명단이 "이어지는 위험"으로도 나오지 않게 (HD-05)
        const afterActions: HealthEvaluation = {
            partitions: evaluation.partitions.map((p) => (ctx.heldNow.has(p.partitionId) ? { ...p, held: true } : p)),
            senders: evaluation.senders.map((sv) => (ctx.pausedNow.has(sv.profileId) ? { ...sv, autoPaused: true } : sv)),
            domains: evaluation.domains,
        };
        const sent = await dailyReport(ctx, afterActions, syncRow);
        stats.report += sent;
    }
}

// ============================================
// 사건 쓰기·실행
// ============================================

/** 알림 묶음에 들어갈 사건 하나. textFor가 있으면 사업 스페이스(워크스페이스)마다 그 사업 명단만 담은 글을 쓴다 (RH-SEC-4) */
interface AlertItem {
    ev: PlannedEvent;
    id: number;
    text: string;
    textFor?: (workspaceId: number) => string;
}

interface EventInsert {
    workspaceId: number | null;
    entityType: "partition" | "sender" | "domain" | "org";
    entityId: number | null;
    entityKey: string | null;
    kind: string;
    level: "danger" | "caution" | "info";
    action: string;
    actionNote: string | null;
    evalWindow: string | null;
    dedupeKey: string;
    metrics: Record<string, unknown>;
    summary: string;
    actorUserId?: string | null;
    mode?: SendHealthMode;
}

async function insertEvent(ctx: { orgId: string; config: SendHealthConfig }, e: EventInsert): Promise<{ id: number; isNew: boolean; action: string }> {
    const rows = await q<{ id: number }>(sql`
        INSERT INTO email_health_events
            (org_id, workspace_id, entity_type, entity_id, entity_key, kind, level, mode, action, action_note, eval_window,
             dedupe_key, metrics, summary, actor_user_id)
        VALUES (${ctx.orgId}::uuid, ${e.workspaceId}, ${e.entityType}, ${e.entityId}, ${e.entityKey ? e.entityKey.slice(0, 220) : null},
                ${e.kind}, ${e.level}, ${e.mode ?? ctx.config.mode}, ${e.action}, ${e.actionNote}, ${e.evalWindow},
                ${e.dedupeKey.slice(0, 200)}, ${JSON.stringify(e.metrics)}::jsonb, ${e.summary}, ${e.actorUserId ?? null})
        ON CONFLICT (org_id, dedupe_key) DO NOTHING
        RETURNING id
    `);
    if (rows.length > 0) return { id: num(rows[0].id), isNew: true, action: e.action };
    const existing = await q<{ id: number; action: string }>(sql`
        SELECT id, action FROM email_health_events WHERE org_id = ${ctx.orgId}::uuid AND dedupe_key = ${e.dedupeKey.slice(0, 200)}
    `);
    return { id: num(existing[0]?.id), isNew: false, action: String(existing[0]?.action ?? "none") };
}

/**
 * 계획된 사건 하나: 사건을 남기고(같은 키면 한 번) 조치(보류·멈춤)를 한다. 알릴 것이면 { id, text }를 준다.
 * 사건이 이미 있어도 이번에 조치가 새로 걸렸으면(예: 어제 상한·관문에 걸렸던 위험) 사건을 고치고 다시 알린다.
 */
async function executeEvent(
    ctx: OrgContext,
    ev: PlannedEvent,
    evaluation: HealthEvaluation,
    stats: SendHealthStats
): Promise<AlertItem | null> {
    const { config } = ctx;
    if (ev.entityType === "partition" && ev.entityId !== null) {
        const p = evaluation.partitions.find((x) => x.partitionId === ev.entityId);
        if (!p) return null;
        const metrics = {
            final: p.final,
            failed: p.failedCount,
            rateBp: p.rateBp,
            evalWindow: p.evalWindow,
            unknown: p.unknown,
            unconfirmedBp: p.unconfirmedBp,
            dsnOnly: p.dsnOnly,
            senderSide: p.senderSide,
            wouldAction: ev.wouldAction,
            floorAt: p.floorAt?.toISOString() ?? null,
        };
        const ins = await insertEvent(ctx, {
            workspaceId: p.workspaceId,
            entityType: "partition",
            entityId: p.partitionId,
            entityKey: null,
            kind: "danger",
            level: "danger",
            action: ev.action,
            actionNote: ev.actionNote,
            evalWindow: p.evalWindow,
            dedupeKey: ev.dedupeKey,
            metrics,
            summary: holdReasonText(p),
        });
        let acted = false;
        let heldQueue: number | null = null;
        if (ev.action === "hold") {
            const r = await holdPartition({
                orgId: ctx.orgId,
                workspaceId: p.workspaceId ?? 0,
                partitionId: p.partitionId,
                reasonText: holdReasonText(p),
                metrics,
                eventId: ins.id,
            });
            acted = r.isNew;
            if (acted) {
                stats.holds++;
                ctx.heldNow.add(p.partitionId);
                heldQueue = r.queued.sendQueue + r.queued.followup + r.queued.automation;
            }
        }
        const effective = acted ? ev : { ...ev, action: "none" as const, actionNote: ev.action === "hold" ? ("already" as const) : ev.actionNote };
        if (!ins.isNew && !acted) return null;
        if (ins.isNew) stats.events++;
        if (!ins.isNew && acted) await updateEventAction(ctx.orgId, ins.id, "hold", null);
        if (ins.isNew && ev.action === "hold" && !acted) await updateEventAction(ctx.orgId, ins.id, "none", "already");
        const reasons = await failReasonsForPartition(ctx, p.partitionId);
        const senderRates = p.senderShares.map((s) => ({
            email: ctx.senders.find((x) => x.id === s.profileId)?.email || "기본 발신 주소",
            rateBp: s.rateBp,
            final: s.final,
        }));
        const text = partitionDangerText({
            p,
            workspaceName: p.workspaceId ? ctx.workspaceNames.get(p.workspaceId) ?? null : null,
            mode: config.mode,
            action: effective.action === "hold" ? "hold" : "none",
            actionNote: effective.actionNote,
            reasons,
            heldQueue,
            senderRates,
            baseUrl: config.baseUrl,
            worsenedFromBucket: ev.worsenedFromBucket ?? null,
        });
        return { ev: effective, id: ins.id, text };
    }

    if (ev.entityType === "sender" && ev.kind === "danger") {
        const s = evaluation.senders.find((x) => x.profileId === ev.entityId);
        if (!s) return null;
        const metrics = {
            final: s.final,
            failed: s.failedCount,
            rateBp: s.rateBp,
            dangerBy: s.dangerBy,
            outlierCells: s.outlierCells.map((c) => ({ p: c.partitionId, final: c.final, failed: c.failed, restRateBp: c.restRateBp, pValue: c.pValue })),
            highCells: s.highCells.map((c) => ({ p: c.partitionId, final: c.final, failed: c.failed, rateBp: c.rateBp })),
            wouldAction: ev.wouldAction,
            floorAt: s.floorAt?.toISOString() ?? null,
        };
        const reason =
            s.dangerBy === "multi"
                ? `명단 ${s.highCells.length}개에서 함께 발송 실패율 5% 이상`
                : `발송 실패가 같은 명단의 다른 주소보다 뚜렷이 많음 (명단 ${s.outlierCells.length}개)`;
        const ins = await insertEvent(ctx, {
            workspaceId: s.workspaceIds[0] ?? null,
            entityType: "sender",
            entityId: s.profileId,
            entityKey: s.email || null,
            kind: "danger",
            level: "danger",
            action: ev.action,
            actionNote: ev.actionNote,
            evalWindow: "7d",
            dedupeKey: ev.dedupeKey,
            metrics,
            summary: reason,
        });
        let acted = false;
        if (ev.action === "pause") {
            acted = await pauseSenderForHealth(ctx.orgId, s.profileId, reason);
            if (acted) {
                stats.pauses++;
                ctx.pausedNow.add(s.profileId);
            }
        }
        const effective = acted ? ev : { ...ev, action: "none" as const, actionNote: ev.action === "pause" ? ("already" as const) : ev.actionNote };
        if (!ins.isNew && !acted) return null;
        if (ins.isNew) stats.events++;
        if (!ins.isNew && acted) await updateEventAction(ctx.orgId, ins.id, "pause", null);
        if (ins.isNew && ev.action === "pause" && !acted) await updateEventAction(ctx.orgId, ins.id, "none", "already");
        const pools = await rulePoolsFor(ctx, s.profileId);
        const info = ctx.senders.find((x) => x.id === s.profileId);
        const textInput = {
            s,
            mode: config.mode,
            action: effective.action === "pause" ? ("pause" as const) : ("none" as const),
            actionNote: effective.actionNote,
            partitionNames: ctx.partitionNames,
            rulePools: pools,
            warmup: !!info && (await warmupOn(ctx.orgId, s.profileId)),
            baseUrl: config.baseUrl,
            worsenedFromBucket: ev.worsenedFromBucket ?? null,
        };
        return {
            ev: effective,
            id: ins.id,
            text: senderDangerText(textInput),
            textFor: (ws) => senderDangerText({ ...textInput, scope: { workspaceId: ws, partitionWorkspace: ctx.partitionWorkspace } }),
        };
    }

    if (ev.kind === "danger_with") {
        const s = evaluation.senders.find((x) => x.profileId === ev.entityId);
        if (!s) return null;
        const items = s.primaryOfDanger.map((pid) => {
            const p = evaluation.partitions.find((x) => x.partitionId === pid);
            const share = p?.senderShares.find((x) => x.profileId === s.profileId)?.shareBp ?? 0;
            return {
                partitionId: pid,
                name: ctx.partitionNames.get(pid) ?? `명단 ${pid}`,
                rateBp: p?.rateBp ?? null,
                shareBp: share,
                held: !!p?.held || ctx.heldNow.has(pid),
            };
        });
        const withInput = { s, partitions: items, held: items.length > 0 && items.every((i) => i.held) };
        const text = senderWithPartitionsText(withInput);
        const ins = await insertEvent(ctx, {
            workspaceId: ev.workspaceIds[0] ?? null,
            entityType: "sender",
            entityId: s.profileId,
            entityKey: s.email || null,
            kind: "danger_with",
            level: "danger",
            action: "none",
            actionNote: null,
            evalWindow: "7d",
            dedupeKey: ev.dedupeKey,
            metrics: { partitions: s.primaryOfDanger, shares: items.map((i) => i.shareBp) },
            summary: `위험 명단 ${s.primaryOfDanger.length}개의 주된 발신`,
        });
        if (!ins.isNew) return null;
        stats.events++;
        return {
            ev,
            id: ins.id,
            text,
            textFor: (ws) => senderWithPartitionsText({ ...withInput, scope: { workspaceId: ws, partitionWorkspace: ctx.partitionWorkspace } }),
        };
    }

    if (ev.kind === "auth_burst") {
        const d = evaluation.domains.find((x) => x.domain === ev.entityKey);
        if (!d) return null;
        const metrics = { final1h: d.final1h, senderSide1h: d.senderSide1h, profiles: d.profileIds, wouldAction: ev.wouldAction };
        const ins = await insertEvent(ctx, {
            workspaceId: null,
            entityType: "domain",
            entityId: null,
            entityKey: d.domain,
            kind: "auth_burst",
            level: "danger",
            action: ev.action,
            actionNote: ev.actionNote,
            evalWindow: null,
            dedupeKey: ev.dedupeKey,
            metrics,
            summary: `최근 1시간 발신 쪽 실패 ${d.senderSide1h}통`,
        });
        const paused: number[] = [];
        if (ev.action === "pause") {
            for (const id of ev.pauseProfileIds) {
                if (await pauseSenderForHealth(ctx.orgId, id, "발신 쪽 실패 폭주 (5.7.x·SST7/8) — 도메인 인증 확인")) {
                    paused.push(id);
                    ctx.pausedNow.add(id);
                }
            }
            stats.pauses += paused.length;
        }
        const acted = paused.length > 0;
        if (!ins.isNew && !acted) return null;
        if (ins.isNew) stats.events++;
        if (!ins.isNew && acted) await updateEventAction(ctx.orgId, ins.id, "pause", null);
        if (ins.isNew && ev.action === "pause" && !acted) await updateEventAction(ctx.orgId, ins.id, "none", "already");
        const reasons = await failReasonsForDomain(ctx, d.domain);
        const emailOf = (id: number) => ctx.senders.find((x) => x.id === id)?.email ?? `주소 ${id}`;
        const text = authBurstText({
            d,
            mode: config.mode,
            action: acted ? "pause" : "none",
            actionNote: acted ? null : ev.action === "pause" ? "already" : ev.actionNote,
            reasons,
            pausedEmails: paused.map(emailOf),
            skippedEmails: ev.skippedProfileIds.map(emailOf),
            defaultEmails: ev.skippedProfileIds.filter((id) => ctx.senders.find((x) => x.id === id)?.isDefault).map(emailOf),
        });
        return { ev: { ...ev, action: acted ? "pause" : "none" }, id: ins.id, text };
    }
    return null;
}

async function updateEventAction(orgId: string, id: number, action: string, note: string | null): Promise<void> {
    await db.execute(sql`
        UPDATE email_health_events SET action = ${action}, action_note = ${note}
        WHERE id = ${id}::int AND org_id = ${orgId}::uuid
    `);
}

async function warmupOn(orgId: string, profileId: number): Promise<boolean> {
    const rows = await q<{ w: boolean }>(sql`
        SELECT warmup_enabled AS w FROM email_sender_profiles WHERE id = ${profileId}::int AND org_id = ${orgId}::uuid
    `);
    return rows[0]?.w === true;
}

/** 실패 사유 상위 (실패 기록만, 7일) — 알림 글용 */
async function failReasonsForPartition(ctx: OrgContext, partitionId: number): Promise<FailReason[]> {
    const since = new Date(ctx.now.getTime() - DEFAULT_THRESHOLDS.slowWindowMs).toISOString();
    const rows = await q<{ status: string | null; n: number }>(sql`
        SELECT l.delivery_status_code AS status, count(*)::int AS n
        FROM email_send_logs l
        WHERE l.org_id = ${ctx.orgId}::uuid AND l.partition_id = ${partitionId}::int
          AND l.sent_at >= ${since}::timestamptz AND l.sent_at < ${ctx.now.toISOString()}::timestamptz
          AND (${sql.raw(HEALTH_CATEGORY_SQL)}) = 'failed'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    `);
    return rows.map((r) => ({ status: r.status, count: num(r.n) }));
}

async function failReasonsForDomain(ctx: OrgContext, domain: string): Promise<FailReason[]> {
    const since = new Date(ctx.now.getTime() - DEFAULT_THRESHOLDS.authBurstWindowMs).toISOString();
    const rows = await q<{ status: string | null; n: number }>(sql`
        SELECT COALESCE(l.delivery_status_code, l.nhn_status_code) AS status, count(*)::int AS n
        FROM email_send_logs l
        WHERE l.org_id = ${ctx.orgId}::uuid
          AND l.sent_at >= ${since}::timestamptz AND l.sent_at < ${ctx.now.toISOString()}::timestamptz
          AND lower(split_part(COALESCE(l.sender_email, ''), '@', 2)) = ${domain}
          AND (${sql.raw(HEALTH_CATEGORY_SQL)}) = 'sender_side'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    `);
    return rows.map((r) => ({ status: r.status, count: num(r.n) }));
}

/** 이 주소를 묶음에 둔 켜진 AI 규칙 (이름, 묶음 크기, 규칙 명단의 워크스페이스 — 사업 스페이스 글은 그 사업 규칙만, HB-5) */
async function rulePoolsFor(ctx: OrgContext, profileId: number): Promise<Array<{ name: string; size: number; workspaceId: number | null }>> {
    const rows = await q<Row>(sql`
        SELECT a.id, a.name, a.sender_profile_id, a.sender_profile_ids, p.workspace_id
        FROM email_auto_personalized_links a
        JOIN partitions p ON p.id = a.partition_id
        JOIN workspaces w ON w.id = p.workspace_id
        WHERE w.org_id = ${ctx.orgId}::uuid AND a.is_active = 1
    `);
    const out: Array<{ name: string; size: number; workspaceId: number | null }> = [];
    for (const r of rows) {
        const pool = linkSenderPool({
            senderProfileId: r.sender_profile_id === null ? null : num(r.sender_profile_id),
            senderProfileIds: Array.isArray(r.sender_profile_ids) ? (r.sender_profile_ids as number[]) : null,
        });
        if (pool.includes(profileId)) {
            out.push({ name: String(r.name ?? `규칙 ${num(r.id)}`), size: pool.length, workspaceId: r.workspace_id === null ? null : num(r.workspace_id) });
        }
    }
    return out.slice(0, 5);
}

// ============================================
// 위험 구간 (F7·OPS-4)
// ============================================

interface EpisodeInfo {
    /** 지금 위험인 대상의 구간 시작 */
    dangerStart: { partitions: Map<number, Date>; senders: Map<number, Date> };
    /** 하루 건강 줄에 이어 적을 값 (entity_key → 구간 시작·마지막 위험) */
    byKey: Map<string, { ep: string | null; lastDanger: string | null }>;
}

/** 하루 건강의 가장 최근 줄(오늘 줄은 아직 덮어쓰기 전 = 지난 회차)로 대상마다 위험 구간을 정한다 */
async function loadDangerEpisodes(ctx: OrgContext, ev: HealthEvaluation): Promise<EpisodeInfo> {
    const targets = [
        ...ev.partitions.map((p) => ({ key: p.key, kind: "p" as const, id: p.partitionId, state: p.state })),
        ...ev.senders.map((s) => ({ key: s.key, kind: "s" as const, id: s.profileId, state: s.state })),
    ];
    const out: EpisodeInfo = { dangerStart: { partitions: new Map(), senders: new Map() }, byKey: new Map() };
    if (targets.length === 0) return out;
    const since = addDaysYmd(kstDayStart(ctx.now).date, -60);
    const rows = await q<{ entity_key: string; state: string; ep: string | null; last_danger: string | null }>(sql`
        SELECT DISTINCT ON (entity_key) entity_key, state, reasons->>'ep' AS ep, reasons->>'lastDanger' AS last_danger
        FROM email_health_daily
        WHERE org_id = ${ctx.orgId}::uuid AND health_date >= ${since}
          AND entity_key = ANY(${sql.param(targets.map((t) => t.key))}::text[])
        ORDER BY entity_key, health_date DESC
    `);
    const prevBy = new Map(rows.map((r) => [r.entity_key, r]));
    for (const t of targets) {
        const prev = prevBy.get(t.key);
        const prevState = prev
            ? { state: prev.state, episodeAt: toDate(prev.ep), lastDangerAt: toDate(prev.last_danger) }
            : null;
        if (t.state === "danger") {
            const start = dangerEpisodeStart(prevState, ctx.now);
            (t.kind === "p" ? out.dangerStart.partitions : out.dangerStart.senders).set(t.id, start);
            out.byKey.set(t.key, { ep: start.toISOString(), lastDanger: ctx.now.toISOString() });
        } else {
            out.byKey.set(t.key, {
                ep: prevState?.episodeAt?.toISOString() ?? null,
                lastDanger: prevState?.lastDangerAt?.toISOString() ?? null,
            });
        }
    }
    return out;
}

/** 이 조직이 최근 60일에 남긴 위험 사건 키 (같은 구간 안에서 이미 알린 칸) */
async function loadDangerKeys(orgId: string, now: Date): Promise<Set<string>> {
    const rows = await q<{ dedupe_key: string }>(sql`
        SELECT dedupe_key FROM email_health_events
        WHERE org_id = ${orgId}::uuid AND kind = 'danger'
          AND created_at >= ${new Date(now.getTime() - 60 * DAY_MS).toISOString()}::timestamptz
    `);
    return new Set(rows.map((r) => r.dedupe_key));
}

// ============================================
// 하루 건강 (H30)
// ============================================

async function writeDaily(ctx: OrgContext, ev: HealthEvaluation, episodes: EpisodeInfo): Promise<void> {
    const date = kstDayStart(ctx.now).date;
    const rows: Array<Record<string, unknown>> = [];
    for (const p of ev.partitions) {
        rows.push({
            k: p.key,
            ws: p.workspaceId,
            f: p.final,
            fl: p.failedCount,
            ss: p.senderSide,
            nu: p.nhnUnsub,
            un: p.unknown,
            dsn: p.dsnOnly,
            bp: p.rateBp,
            st: p.state,
            w: p.evalWindow,
            r: {
                held: p.held,
                recovered: p.recovered,
                unconfirmedBp: p.unconfirmedBp,
                senders: p.senderShares.slice(0, 10),
                ep: episodes.byKey.get(p.key)?.ep ?? null,
                lastDanger: episodes.byKey.get(p.key)?.lastDanger ?? null,
            },
            ws_at: p.windowStart.toISOString(),
        });
    }
    for (const s of ev.senders) {
        rows.push({
            k: s.key,
            ws: s.workspaceIds[0] ?? null,
            f: s.final,
            fl: s.failedCount,
            ss: s.senderSide,
            nu: s.nhnUnsub,
            un: s.unknown,
            dsn: s.dsnOnly,
            bp: s.rateBp,
            st: s.state,
            w: "7d",
            r: {
                outliers: s.outlierCells.length,
                dangerBy: s.dangerBy,
                highCells: s.highCells.slice(0, 10).map((c) => ({ p: c.partitionId, f: c.final, fl: c.failed })),
                cells: s.cells.map((c) => ({ p: c.partitionId, f: c.final, fl: c.failed, rf: c.restFinal, rfl: c.restFailed, pv: c.pValue, o: c.outlier })),
                primaryOfDanger: s.primaryOfDanger,
                autoPaused: s.autoPaused,
                recovered: s.recovered,
                workspaces: s.workspaceIds,
                ep: episodes.byKey.get(s.key)?.ep ?? null,
                lastDanger: episodes.byKey.get(s.key)?.lastDanger ?? null,
            },
            ws_at: s.windowStart.toISOString(),
        });
    }
    for (const d of ev.domains) {
        rows.push({
            k: d.key.slice(0, 220),
            ws: null,
            f: d.final7d,
            fl: d.failed7d,
            ss: d.senderSide7d,
            nu: 0,
            un: 0,
            dsn: 0,
            bp: d.rateBp7d,
            st: d.state,
            w: "7d",
            r: { burst: d.burst, final1h: d.final1h, senderSide1h: d.senderSide1h, senderSide24h: d.senderSide24h, profiles: d.profileIds },
            ws_at: new Date(ctx.now.getTime() - DEFAULT_THRESHOLDS.windowMs).toISOString(),
        });
    }
    for (let i = 0; i < rows.length; i += 200) {
        const part = rows.slice(i, i + 200);
        await db.execute(sql`
            INSERT INTO email_health_daily
                (org_id, health_date, entity_key, workspace_id, final_count, failed_count, sender_side_count, nhn_unsub_count,
                 unknown_count, dsn_only_count, rate_bp, state, eval_window, reasons, window_start, evaluated_at)
            SELECT ${ctx.orgId}::uuid, ${date}, v.k, v.ws, v.f, v.fl, v.ss, v.nu, v.un, v.dsn, v.bp, v.st, v.w, v.r, v.ws_at, ${ctx.now.toISOString()}::timestamptz
            FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb)
                AS v(k text, ws int, f int, fl int, ss int, nu int, un int, dsn int, bp int, st text, w text, r jsonb, ws_at timestamptz)
            ON CONFLICT (org_id, health_date, entity_key) DO UPDATE SET
                workspace_id = EXCLUDED.workspace_id, final_count = EXCLUDED.final_count, failed_count = EXCLUDED.failed_count,
                sender_side_count = EXCLUDED.sender_side_count, nhn_unsub_count = EXCLUDED.nhn_unsub_count,
                unknown_count = EXCLUDED.unknown_count, dsn_only_count = EXCLUDED.dsn_only_count, rate_bp = EXCLUDED.rate_bp,
                state = EXCLUDED.state, eval_window = EXCLUDED.eval_window, reasons = EXCLUDED.reasons,
                window_start = EXCLUDED.window_start, evaluated_at = EXCLUDED.evaluated_at
        `);
    }
}

// ============================================
// 알림 줄 (7-1·7-2)
// ============================================

function initialAlertStatus(
    config: SendHealthConfig,
    env: Record<string, string | undefined>,
    target: "ops" | number,
    opts: { urgent: boolean; now: Date }
): { status: string; lastError: string | null } {
    if (config.mode === "dry_run") return { status: "dry_run", lastError: null };
    if (config.mode === "off") return { status: "skipped", lastError: "모드 off" };
    const hook = healthWebhookInfo(env, target);
    if (!hook.url) return { status: "skipped", lastError: hook.problem ?? NO_WEBHOOK };
    if (!opts.urgent && isQuietHour(opts.now)) return { status: "skipped", lastError: NIGHT_SKIP };
    return { status: "pending", lastError: null };
}

async function insertAlert(
    ctx: { orgId: string; config: SendHealthConfig; env: Record<string, string | undefined>; now: Date },
    batchKey: string,
    target: "ops" | number,
    eventIds: number[],
    message: string,
    urgent: boolean,
    scheduledAt?: Date | null
): Promise<void> {
    const st = initialAlertStatus(ctx.config, ctx.env, target, { urgent, now: ctx.now });
    await db.execute(sql`
        INSERT INTO email_health_alerts (org_id, batch_key, event_ids, target, workspace_id, message, status, last_error, scheduled_at)
        VALUES (${ctx.orgId}::uuid, ${batchKey.slice(0, 80)}, ${sql.param(eventIds)}::int[], ${target === "ops" ? "ops" : `ws:${target}`},
                ${target === "ops" ? null : target}, ${message}, ${st.status}, ${st.lastError},
                ${scheduledAt ? sql`${scheduledAt.toISOString()}::timestamptz` : sql`now()`})
        ON CONFLICT (org_id, batch_key, target) DO NOTHING
    `);
}

/**
 * 한 회차의 새 사건을 받는 곳마다 한 통으로 묶는다 — 운영은 모두, 사업 스페이스는 그 워크스페이스 사건만.
 * 사업 스페이스 글은 그 사업 명단만 담는다 (주소 위험·주된 발신 글의 다른 사업 명단은 숫자만 — RH-SEC-4)
 */
async function queueBatchAlerts(ctx: OrgContext, batchKey: string, items: AlertItem[]): Promise<void> {
    const targets = new Map<"ops" | number, typeof items>();
    targets.set("ops", items);
    for (const it of items) {
        for (const ws of it.ev.workspaceIds) {
            if (!targets.has(ws)) targets.set(ws, []);
            targets.get(ws)!.push(it);
        }
    }
    const isUrgent = (x: AlertItem) => x.ev.urgent || x.ev.action !== "none";
    for (const [target, raw] of targets) {
        if (raw.length === 0) continue;
        // 조치·상한·폭주 같은 급한 블록을 앞에 — 3,800자에 다 들어가지 않아도 가장 중요한 요약이 빠지지 않게 (HB-4)
        const list = [...raw].sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)));
        const blocks = list.map((x) => (target !== "ops" && x.textFor ? x.textFor(target) : x.text));
        const worse = list.map((x) => x.ev.worsenedFromBucket !== null && x.ev.worsenedFromBucket !== undefined);
        const message = batchAlertText({ orgName: ctx.orgName, blocks, baseUrl: ctx.config.baseUrl, worse });
        const urgent = list.some(isUrgent);
        await insertAlert(ctx, batchKey, target, list.map((x) => x.id), message, urgent);
    }
}

/** 이 조직의 마지막 NHN 결과 확인 알림 사건 (그 원인·갈래) — 알린 때는 회차 시각(metrics.at)으로 본다 */
async function lastSyncAlertAt(ctx: OrgContext, prefix: string): Promise<Date | null> {
    const rows = await q<Row>(sql`
        SELECT metrics->>'at' AS at, created_at FROM email_health_events
        WHERE org_id = ${ctx.orgId}::uuid AND kind = 'sync' AND dedupe_key LIKE ${`${prefix}%`}
        ORDER BY id DESC LIMIT 1
    `);
    if (!rows[0]) return null;
    return toDate(rows[0].at) ?? toDate(rows[0].created_at);
}

/** 이 원인의 마지막 운영 알림을 끝내 못 보냈나 (429·5xx로 실패, 묵어서 닫힘) — 1시간 지났으면 다시 만든다 (HS-5) */
async function lastSyncAlertFailed(ctx: OrgContext, cause: string): Promise<boolean> {
    const rows = await q<Row>(sql`
        SELECT status, last_error FROM email_health_alerts
        WHERE org_id = ${ctx.orgId}::uuid AND target = 'ops' AND batch_key LIKE ${`sync:${cause}:live:%`}
          AND created_at < now() - interval '1 hour'
        ORDER BY id DESC LIMIT 1
    `);
    const r = rows[0];
    if (!r) return false;
    return r.status === "failed" || (r.status === "skipped" && String(r.last_error ?? "").startsWith("오래되어"));
}

/**
 * NHN 결과 확인 정체·키 오류는 운영 스페이스에 바로, 같은 장애는 마지막 알림 6시간 뒤에 다시(밤이면 아침에), 다시 되면 한 번 (3-5, SND-02).
 *   - 알린 장애 구간(ops_alerted_at·ops_alerted_cause)이 없거나 원인이 바뀌면 바로 — 회복 뒤 같은 6시간 안에 다시 막혀도 알린다 (HS-1)
 *   - 시험 모드(dry_run)는 기록만 하고 구간을 열지 않는다 — alert로 바꾼 뒤 이어지는 장애를 바로 알리고, 보내지 않은 경고의 회복 글만
 *     가지 않게 (HS-4)
 *   - 마지막 알림을 못 보냈으면 다시 만든다 (HS-5) · 결과 확인을 일부러 껐으면(NHN_STATUS_SYNC=off) 남은 키 오류로 알리지 않는다 (HS-9)
 *   - 한 번도 안 돌던 결과 확인이 돌기 시작하면 한 번 (HS-8) · 새 사건은 회차 숫자 events에 센다 (HS-14)
 */
async function syncAlerts(
    ctx: OrgContext,
    syncRow: Row | null,
    gate: "sync_stale" | "sync_initial" | null,
    stats: SendHealthStats
): Promise<void> {
    if (!syncRow) {
        await syncNeverRanAlert(ctx, stats);
        return;
    }
    const syncEnabled = (ctx.env.NHN_STATUS_SYNC ?? "on").trim().toLowerCase() !== "off";
    const live = ctx.config.mode === "alert" || ctx.config.mode === "enforce";
    const lastOkAt = toDate(syncRow.last_ok_at);
    const alertedAt = toDate(syncRow.ops_alerted_at);
    const alertedCause = (syncRow.ops_alerted_cause as string | null) ?? null;
    const code = (syncRow.last_error_code as string | null) ?? null;
    const clearEpisode = async () => {
        await db.execute(sql`UPDATE email_status_sync_state SET ops_alerted_at = NULL, ops_alerted_cause = NULL WHERE org_id = ${ctx.orgId}::uuid`);
    };
    if (!syncEnabled) {
        if (alertedAt) await clearEpisode();
        return;
    }
    const cause: "auth" | "stale" | null = code === "auth" ? "auth" : gate === "sync_stale" ? "stale" : null;
    if (cause) {
        const last = await lastSyncAlertAt(ctx, `sync:${cause}:${live ? "live" : "dry"}:`);
        const sinceLast = last ? ctx.now.getTime() - last.getTime() : Number.POSITIVE_INFINITY;
        let due: boolean;
        if (!live) due = sinceLast >= SYNC_REPEAT_MS;
        else if (!alertedAt || alertedCause !== cause) due = true;
        else if (await lastSyncAlertFailed(ctx, cause)) due = true;
        else due = sinceLast >= SYNC_REPEAT_MS && !isQuietHour(ctx.now);
        if (!due) return;
        const text = syncAlertText({
            cause,
            orgName: ctx.orgName,
            lastOkAt,
            lastError: (syncRow.last_error as string | null) ?? null,
            baseUrl: ctx.config.baseUrl,
            staleMinutes: lastOkAt ? Math.floor((ctx.now.getTime() - lastOkAt.getTime()) / 60_000) : null,
        });
        const key = dedupeKey.syncAlert(cause, ctx.config.mode, ctx.now);
        const ins = await insertEvent(ctx, {
            workspaceId: null,
            entityType: "org",
            entityId: null,
            entityKey: null,
            kind: "sync",
            level: "danger",
            action: "none",
            actionNote: null,
            evalWindow: null,
            dedupeKey: key,
            metrics: { cause, at: ctx.now.toISOString(), lastOkAt: lastOkAt?.toISOString() ?? null, code },
            summary: text,
        });
        if (!ins.isNew) return;
        stats.events++;
        await insertAlert(ctx, key, "ops", [ins.id], text, true);
        if (live) {
            await db.execute(sql`
                UPDATE email_status_sync_state SET ops_alerted_at = ${ctx.now.toISOString()}::timestamptz, ops_alerted_cause = ${cause}
                WHERE org_id = ${ctx.orgId}::uuid
            `);
        }
        return;
    }
    if (alertedAt) {
        if (!live) {
            await clearEpisode();
            return;
        }
        // 회복 글은 밤에는 아침에 (HS-6) — 그사이 다시 막히면 같은 구간으로 이어진다
        if (isQuietHour(ctx.now)) return;
        const text = syncAlertText({ cause: "recovered", orgName: ctx.orgName, lastOkAt, lastError: null, baseUrl: ctx.config.baseUrl });
        const ins = await insertEvent(ctx, {
            workspaceId: null,
            entityType: "org",
            entityId: null,
            entityKey: null,
            kind: "sync",
            level: "info",
            action: "none",
            actionNote: null,
            evalWindow: null,
            dedupeKey: dedupeKey.syncRecovered(alertedAt, alertedCause),
            metrics: { cause: "recovered", at: ctx.now.toISOString() },
            summary: text,
        });
        if (ins.isNew) {
            stats.events++;
            await insertAlert(ctx, dedupeKey.syncRecovered(alertedAt, alertedCause), "ops", [ins.id], text, true);
        }
        await clearEpisode();
        return;
    }
    if (live) await syncNeverRecovered(ctx, stats);
}

/**
 * NHN 결과 맞추기가 한 번도 돌지 않았다 (OPS-8): 상태 줄이 없는데 1시간 넘게 지난 발송(48시간 안, 요청 번호 있음)이 있으면
 * status-sync 정기 작업이 빠진 것 — 그동안 관문이 늘 sync_initial이라 enforce여도 아무것도 하지 않는다. 운영 스페이스에 바로,
 * 이어지면 마지막 알림 6시간 뒤(밤이면 아침에). NHN_STATUS_SYNC=off로 일부러 끈 경우는 알리지 않는다
 */
async function syncNeverRanAlert(ctx: OrgContext, stats: SendHealthStats): Promise<void> {
    if ((ctx.env.NHN_STATUS_SYNC ?? "on").trim().toLowerCase() === "off") return;
    const rows = await q<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM (
            SELECT 1 FROM email_send_logs
            WHERE org_id = ${ctx.orgId}::uuid AND request_id IS NOT NULL
              AND sent_at >= ${new Date(ctx.now.getTime() - 48 * HOUR_MS).toISOString()}::timestamptz
              AND sent_at <= ${new Date(ctx.now.getTime() - HOUR_MS).toISOString()}::timestamptz
              AND COALESCE(trigger_type, '') NOT LIKE 'test%'
            LIMIT 1
        ) x
    `);
    if (num(rows[0]?.n) === 0) return;
    const live = ctx.config.mode === "alert" || ctx.config.mode === "enforce";
    const last = await lastSyncAlertAt(ctx, `sync:never:${live ? "live" : "dry"}:`);
    const sinceLast = last ? ctx.now.getTime() - last.getTime() : Number.POSITIVE_INFINITY;
    if (last && (sinceLast < SYNC_REPEAT_MS || (live && isQuietHour(ctx.now)))) return;
    const text = syncAlertText({ cause: "never", orgName: ctx.orgName, lastOkAt: null, lastError: null, baseUrl: ctx.config.baseUrl });
    const key = dedupeKey.syncAlert("never", ctx.config.mode, ctx.now);
    const ins = await insertEvent(ctx, {
        workspaceId: null,
        entityType: "org",
        entityId: null,
        entityKey: null,
        kind: "sync",
        level: "danger",
        action: "none",
        actionNote: null,
        evalWindow: null,
        dedupeKey: key,
        metrics: { cause: "never", at: ctx.now.toISOString() },
        summary: text,
    });
    if (!ins.isNew) return;
    stats.events++;
    await insertAlert(ctx, key, "ops", [ins.id], text, true);
}

/** 한 번도 안 돌던 결과 확인이 돌기 시작했다 — 최근 48시간에 "한 번도 안 돎"을 알렸으면 "돌기 시작"을 한 번 (HS-8) */
async function syncNeverRecovered(ctx: OrgContext, stats: SendHealthStats): Promise<void> {
    const rows = await q<{ id: number }>(sql`
        SELECT id FROM email_health_events
        WHERE org_id = ${ctx.orgId}::uuid AND kind = 'sync' AND dedupe_key LIKE 'sync:never:%' AND dedupe_key NOT LIKE 'sync:never:dry:%'
          AND created_at > now() - interval '48 hours'
        ORDER BY id DESC LIMIT 1
    `);
    if (!rows[0]) return;
    const key = `sync:never_recovered:${num(rows[0].id)}`;
    const text = syncAlertText({ cause: "never_recovered", orgName: ctx.orgName, lastOkAt: null, lastError: null, baseUrl: ctx.config.baseUrl });
    const ins = await insertEvent(ctx, {
        workspaceId: null,
        entityType: "org",
        entityId: null,
        entityKey: null,
        kind: "sync",
        level: "info",
        action: "none",
        actionNote: null,
        evalWindow: null,
        dedupeKey: key,
        metrics: { cause: "never_recovered", at: ctx.now.toISOString() },
        summary: text,
    });
    if (!ins.isNew) return;
    stats.events++;
    await insertAlert(ctx, key, "ops", [ins.id], text, true);
}

// ============================================
// 매일 보고 (7-4)
// ============================================

async function dailyReport(ctx: OrgContext, ev: HealthEvaluation, syncRow: Row | null): Promise<number> {
    const key = dedupeKey.report(ctx.now, ctx.config.mode);
    // 오늘 보고를 이미 남겼으면 아래 조회를 하지 않는다 (회차마다 다시 세지 않게)
    const already = await q<{ id: number }>(sql`SELECT id FROM email_health_events WHERE org_id = ${ctx.orgId}::uuid AND dedupe_key = ${key}`);
    if (already.length > 0) return 0;
    const holds = await q<Row>(sql`
        SELECT h.id, h.partition_id, h.held_at FROM email_partition_holds h
        WHERE h.org_id = ${ctx.orgId}::uuid AND h.released_at IS NULL ORDER BY h.held_at
    `);
    const holdList: Array<{ name: string; heldAt: Date; queued: number; workspaceId: number | null }> = [];
    for (const h of holds) {
        const pid = num(h.partition_id);
        const c = await countHeldQueue(ctx.orgId, pid);
        holdList.push({
            name: ctx.partitionNames.get(pid) ?? `명단 ${pid}`,
            heldAt: toDate(h.held_at) ?? ctx.now,
            queued: c.sendQueue + c.followup + c.automation,
            workspaceId: ctx.partitionWorkspace.get(pid) ?? null,
        });
    }
    const autoPaused = await q<Row>(sql`
        SELECT id, from_email, paused_at FROM email_sender_profiles
        WHERE org_id = ${ctx.orgId}::uuid AND is_paused = true AND paused_source = 'auto'
    `);
    const pausedList = autoPaused.map((r) => ({ id: num(r.id), email: String(r.from_email ?? ""), pausedAt: toDate(r.paused_at) }));

    const y = kstYesterdayRange(ctx.now);
    const dsnRows = await q<Row>(sql`
        SELECT count(*) FILTER (WHERE send_log_id IS NULL AND kind <> 'complaint')::int AS unpaired,
               count(*) FILTER (WHERE recipient_match = 'different')::int AS different,
               count(*) FILTER (WHERE kind = 'complaint')::int AS complaints
        FROM email_bounce_signals
        WHERE org_id = ${ctx.orgId}::uuid AND received_at >= ${y.start.toISOString()}::timestamptz AND received_at < ${y.end.toISOString()}::timestamptz
    `);
    const unconfirmed = await q<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM email_send_logs
        WHERE org_id = ${ctx.orgId}::uuid AND request_id IS NOT NULL
          AND sent_at >= ${new Date(ctx.now.getTime() - 48 * HOUR_MS).toISOString()}::timestamptz
          AND sent_at <= ${new Date(ctx.now.getTime() - 2 * HOUR_MS).toISOString()}::timestamptz
          AND (nhn_status_code IS NULL OR nhn_status_code IN ('SST0','SST1','SST4'))
          AND COALESCE(trigger_type, '') NOT LIKE 'test%'
    `);
    const linkUnsubRows = await q<{ workspace_id: number; n: number }>(sql`
        SELECT workspace_id, count(*)::int AS n FROM email_unsubscribes
        WHERE org_id = ${ctx.orgId}::uuid AND unsubscribed_at >= ${y.start.toISOString()}::timestamptz AND unsubscribed_at < ${y.end.toISOString()}::timestamptz
        GROUP BY workspace_id
    `);
    const linkUnsubBy = new Map(linkUnsubRows.map((r) => [num(r.workspace_id), num(r.n)]));
    const linkUnsubTotal = linkUnsubRows.reduce((a, r) => a + num(r.n), 0);
    let reply: { lastSuccessAt: Date | null; mode: string; replies: number; bounces: number } | null = null;
    try {
        const rc = resolveReplyConfig(ctx.env);
        const st = await q<Row>(sql`SELECT last_success_at FROM email_reply_mailbox_state WHERE mailbox = ${rc.mailbox}`);
        const counts = await q<Row>(sql`
            SELECT count(*) FILTER (WHERE kind = 'human')::int AS replies, count(*) FILTER (WHERE kind = 'bounce')::int AS bounces
            FROM email_replies
            WHERE org_id = ${ctx.orgId}::uuid AND received_at >= ${y.start.toISOString()}::timestamptz AND received_at < ${y.end.toISOString()}::timestamptz
        `);
        reply = {
            lastSuccessAt: toDate(st[0]?.last_success_at),
            mode: rc.syncMode,
            replies: num(counts[0]?.replies),
            bounces: num(counts[0]?.bounces),
        };
    } catch {
        reply = null; // 회신 표가 아직 없다 (0074 전)
    }
    const statsJson = (syncRow?.stats ?? null) as Record<string, unknown> | null;
    const sync = syncRow
        ? {
              lastOkAt: toDate(syncRow.last_ok_at),
              cursor: toDate(syncRow.update_cursor),
              unconfirmedOld: num(unconfirmed[0]?.n),
              unpaired: num(statsJson?.unpaired),
              lastErrorCode: (syncRow.last_error_code as string | null) ?? null,
              lastError: (syncRow.last_error as string | null) ?? null,
              skippedWindowsTotal: num(statsJson?.skippedWindowsTotal),
              skippedWindowsLastAt: toDate(statsJson?.skippedWindowsLastAt ?? null),
          }
        : null;
    const senderEmails = new Map(ctx.senders.map((s) => [s.id, s.email]));
    // 이어지는 위험: 함께 쓰는 주소는 그 주소가 보낸 모든 사업 보고에 상세 줄이 나간다 (HD-13)
    const continuing = [
        ...ev.partitions
            .filter((p) => p.state === "danger" && !p.held)
            .map((p) => ({ label: `명단 ${p.name}`, rate: formatRate(p.rateBp), wss: p.workspaceId ? [p.workspaceId] : [] })),
        ...ev.senders
            .filter((s) => s.state === "danger" && !s.autoPaused)
            .map((s) => ({ label: `주소 ${s.email || "기본"}`, rate: formatRate(s.rateBp), wss: s.workspaceIds })),
    ];
    const nhnUnsub = ev.partitions.reduce((a, p) => a + p.nhnUnsub, 0);
    // 알림 전달 문제·어제 못 보낸 알림 (WPN-4·HB-7) — 운영 보고 한 줄
    const deliveryLine = deliveryReportLine(await loadChatDeliveryProblems(ctx.orgId), await failedAlertsIn(ctx.orgId, y));
    // 어제 보고를 못 보냈으면 맨 위에 (HD-15)
    const missed = await q<Row>(sql`
        SELECT status, last_error FROM email_health_alerts
        WHERE org_id = ${ctx.orgId}::uuid AND target = 'ops' AND batch_key = ${dedupeKey.report(new Date(ctx.now.getTime() - DAY_MS), ctx.config.mode)}
          AND status IN ('failed', 'skipped')
        LIMIT 1
    `);
    const missedReport = missed[0] ? String(missed[0].last_error ?? (missed[0].status === "failed" ? "보내기 실패" : "보내지 않음")) : null;
    const base = {
        orgName: ctx.orgName,
        now: ctx.now,
        mode: ctx.config.mode,
        dsnInRate: ctx.config.dsnInRate,
        partitionNames: ctx.partitionNames,
        senderEmails,
        dsn: { unpaired: num(dsnRows[0]?.unpaired), different: num(dsnRows[0]?.different), complaints: num(dsnRows[0]?.complaints) },
        sync,
        reply,
        nhnUnsub,
        linkUnsub: linkUnsubTotal,
        baseUrl: ctx.config.baseUrl,
    };
    // 운영 보고는 실을 것이 있을 때만 (OPS-2): 발송이 있었거나, 위험·주의·보류·멈춤이 있거나, 결과 확인에 문제가 있다.
    // 발송도 문제도 없는 조직까지 매일 카드를 쌓지 않는다. 실을 것이 생기면 그날 다음 회차에 나간다
    const hadSends =
        ev.partitions.some((p) => p.final + p.unknown + p.senderSide + p.nhnUnsub + p.dsnOnly > 0) ||
        ev.senders.some((sv) => sv.final + sv.unknown + sv.senderSide > 0);
    const syncProblem = syncRow ? syncRow.last_error_code !== null && syncRow.last_error_code !== undefined : hadSends;
    if (!hadSends && !syncProblem && !hasReportableItems(ev, holdList.length, pausedList.length)) return 0;
    const opsText = dailyReportText({
        ...base,
        scopeLabel: null,
        evaluation: ev,
        continuing,
        holds: holdList,
        autoPaused: pausedList,
        syncNeverRan: !syncRow,
        deliveryLine,
        missedReport,
    });
    const ins = await insertEvent(ctx, {
        workspaceId: null,
        entityType: "org",
        entityId: null,
        entityKey: null,
        kind: "report",
        level: "info",
        action: "none",
        actionNote: null,
        evalWindow: null,
        dedupeKey: key,
        metrics: {
            danger: ev.partitions.filter((p) => p.state === "danger").length + ev.senders.filter((s) => s.state === "danger").length,
            caution: ev.partitions.filter((p) => p.state === "caution").length + ev.senders.filter((s) => s.state === "caution").length,
            holds: holdList.length,
        },
        summary: opsText.slice(0, 4000),
    });
    if (!ins.isNew) return 0;
    let n = 0;
    // 운영 보고는 정한 시각(SEND_HEALTH_REPORT_HOUR)에 바로 — 대표가 고른 시각이다. 그 시각이 밤(22~08시)이면 사업 스페이스
    // 보고는 08시에 보낸다 (회차가 낮에 못 돌다 밤에 처음 돌아도 마찬가지, HD-09)
    await insertAlert(ctx, key, "ops", [ins.id], opsText, true);
    n++;
    const businessAt = isQuietHour(ctx.now) ? nextMorning(ctx.now) : null;
    const wsIds = new Set<number>();
    for (const p of ev.partitions) if (p.workspaceId) wsIds.add(p.workspaceId);
    for (const h of holdList) if (h.workspaceId) wsIds.add(h.workspaceId);
    for (const ws of [...wsIds].sort((a, b) => a - b)) {
        const scopedSenders = ev.senders.filter((s) => s.workspaceIds.includes(ws));
        const scopedSenderIds = new Set(scopedSenders.map((s) => s.profileId));
        const scoped: HealthEvaluation = {
            partitions: ev.partitions.filter((p) => p.workspaceId === ws),
            senders: scopedSenders,
            // 그 사업 주소들의 도메인만 (늘 0이던 칸을 맞춘다, HD-13)
            domains: ev.domains.filter((d) => d.profileIds.some((id) => scopedSenderIds.has(id))),
        };
        const wsHolds = holdList.filter((h) => h.workspaceId === ws);
        const wsPaused = pausedList.filter((p) => scopedSenderIds.has(p.id));
        if (!hasReportableItems(scoped, wsHolds.length, wsPaused.length)) continue;
        // 사업 보고에는 그 사업 숫자만 — 조직 전체 반송 안내 숫자는 빼고, 수신거부는 그 사업 것만 (HD-02)
        const text = dailyReportText({
            ...base,
            scopeLabel: ctx.workspaceNames.get(ws) ?? `워크스페이스 ${ws}`,
            evaluation: scoped,
            continuing: continuing.filter((c) => c.wss.includes(ws)),
            holds: wsHolds,
            autoPaused: wsPaused,
            sync: null,
            reply: null,
            dsn: null,
            nhnUnsub: scoped.partitions.reduce((a, p) => a + p.nhnUnsub, 0),
            linkUnsub: linkUnsubBy.get(ws) ?? 0,
        });
        await insertAlert(ctx, key, ws, [ins.id], text, true, businessAt);
        n++;
    }
    return n;
}

/** 다음 08시 KST (밤 시간이 끝나는 때) */
function nextMorning(now: Date): Date {
    const day = kstDayStart(now);
    const today8 = new Date(day.start.getTime() + 8 * HOUR_MS);
    return now.getTime() < today8.getTime() ? today8 : new Date(today8.getTime() + DAY_MS);
}

/** 어제 끝내 못 보낸 알림 수 (실패·묵어서 닫힘·웹훅 없음) — 표가 없으면 0 */
async function failedAlertsIn(orgId: string, y: { start: Date; end: Date }): Promise<{ deep: number; reply: number; health: number }> {
    const one = async (query: ReturnType<typeof sql>): Promise<number> => {
        try {
            const r = await q<{ n: number }>(query);
            return num(r[0]?.n);
        } catch {
            return 0;
        }
    };
    const from = y.start.toISOString();
    const to = y.end.toISOString();
    return {
        deep: await one(sql`
            SELECT count(*)::int AS n FROM deep_visitor_alerts
            WHERE org_id = ${orgId}::uuid AND scheduled_at >= ${from}::timestamptz AND scheduled_at < ${to}::timestamptz
              AND (status = 'failed' OR (status = 'skipped' AND (last_error LIKE '오래되어%' OR last_error LIKE '웹훅%')))
        `),
        reply: await one(sql`
            SELECT count(*)::int AS n FROM email_replies
            WHERE org_id = ${orgId}::uuid AND received_at >= ${from}::timestamptz AND received_at < ${to}::timestamptz
              AND (alert_status = 'failed' OR (alert_status = 'skipped' AND (alert_last_error LIKE '오래되어%' OR alert_last_error LIKE '웹훅%')))
        `),
        health: await one(sql`
            SELECT count(*)::int AS n FROM email_health_alerts
            WHERE org_id = ${orgId}::uuid AND created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz
              AND (status = 'failed' OR (status = 'skipped' AND (last_error LIKE '오래되어%' OR last_error LIKE '웹훅%')))
        `),
    };
}

// ============================================
// 풀기 알림 (6-5) — 풀기 API·설정 화면 PUT이 부른다
// ============================================

export async function notifyRelease(input: {
    orgId: string;
    kind: "hold" | "sender";
    /** 보류 id 또는 프로필 id */
    entityId: number;
    workspaceIds: number[];
    name: string;
    releasedAt: Date;
    actorUserId: string;
    actorName: string | null;
    note: string | null;
    /** 사람이 쓴 메모가 아니라 풀린 경로 (발신 주소 설정에서 정지를 끔, HR-9) */
    via?: "settings" | null;
    revived?: number;
    todayCap?: number | null;
    warmupDay?: number | null;
    env?: Record<string, string | undefined>;
}): Promise<void> {
    const env = input.env ?? process.env;
    const config = resolveSendHealthConfig(env);
    const now = new Date();
    const org = await q<{ name: string }>(sql`SELECT name FROM organizations WHERE id = ${input.orgId}::uuid`);
    // 명단 보류면 어느 사업 명단인지 (같은 이름 명단이 여러 사업에 있어도 구별되게, HR-9)
    const ws =
        input.kind === "hold" && input.workspaceIds.length > 0
            ? await q<{ name: string }>(sql`SELECT name FROM workspaces WHERE id = ${input.workspaceIds[0]}::int AND org_id = ${input.orgId}::uuid`)
            : [];
    const text = releaseText({
        kind: input.kind,
        name: input.name,
        actorName: input.actorName,
        note: input.note,
        via: input.via ?? null,
        revived: input.revived,
        todayCap: input.todayCap,
        warmupDay: input.warmupDay,
        orgName: org[0]?.name ?? null,
        workspaceName: ws[0]?.name ?? null,
        baseUrl: config.baseUrl,
    });
    const key = input.kind === "hold" ? dedupeKey.releaseHold(input.entityId) : dedupeKey.releaseSender(input.entityId, input.releasedAt);
    const ctx = { orgId: input.orgId, config, env, now };
    try {
        const ins = await insertEvent(ctx, {
            workspaceId: input.workspaceIds[0] ?? null,
            entityType: input.kind === "hold" ? "partition" : "sender",
            entityId: input.entityId,
            entityKey: input.kind === "sender" ? input.name : null,
            kind: "release",
            level: "info",
            action: "release",
            actionNote: null,
            evalWindow: null,
            dedupeKey: key,
            metrics: { note: input.note, revived: input.revived ?? null, todayCap: input.todayCap ?? null },
            summary: text,
            actorUserId: input.actorUserId,
            // off 모드에서도 풀기 기록은 남긴다 (모드 칸 길이 안)
            mode: config.mode === "off" ? "dry_run" : config.mode,
        });
        if (!ins.isNew) return;
        // 조직 이름은 글 첫 줄에 이미 있다 (머리를 두 번 붙이지 않는다, HR-9)
        await insertAlert(ctx, key, "ops", [ins.id], text, true);
        for (const w of input.workspaceIds) await insertAlert(ctx, key, w, [ins.id], text, true);
        void deliverHealthAlerts({ env, batchKey: key }).catch((e) => console.error(`[send-health] 풀림 알림 보내기 실패: ${shortError(e)}`));
    } catch (e) {
        // 풀기 자체는 이미 끝났다 — 알림 기록 실패로 되돌리지 않는다
        console.error(`[send-health] 풀림 사건 기록 실패: ${shortError(e)}`);
    }
}

// ============================================
// 알림 보내기 (7-2)
// ============================================

export async function deliverHealthAlerts(opts: {
    env?: Record<string, string | undefined>;
    deadline?: number;
    batchKey?: string;
    post?: (url: string, text: string, opts?: ChatPostOptions) => Promise<GoogleChatResult>;
    sleep?: (ms: number) => Promise<void>;
} = {}): Promise<{ sent: number; failed: number; requeued: number; skipped: number }> {
    const env = opts.env ?? process.env;
    const config = resolveSendHealthConfig(env);
    const post = opts.post ?? ((url: string, text: string, o?: ChatPostOptions) => postGoogleChatText(url, text, fetch, o));
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = opts.deadline ?? Date.now() + 60 * 1000;
    const tally = { sent: 0, failed: 0, requeued: 0, skipped: 0 };
    const byKey = opts.batchKey ? sql`AND batch_key = ${opts.batchKey}` : sql``;

    // 시험·꺼짐 모드면 보내지 않는다 — alert 때 429·5xx로 미뤄 둔 줄이 dry_run으로 내린 뒤에 나가지 않게 (HR-6)
    if (config.mode === "dry_run" || config.mode === "off") {
        const closed = await q<{ id: number }>(sql`
            UPDATE email_health_alerts SET status = 'skipped', locked_at = NULL, last_error = ${`모드 ${config.mode} — 보내지 않음`}
            WHERE status = 'pending' ${byKey}
            RETURNING id
        `);
        tally.skipped += closed.length;
        return tally;
    }
    const idempotent = chatRequestIdEnabled(env);
    /** 보내지 않은 줄을 pending으로 되돌린다 (시도 수도 되돌린다) */
    const release = async (ids: number[]) => {
        if (ids.length === 0) return;
        await db.execute(sql`
            UPDATE email_health_alerts SET status = 'pending', locked_at = NULL, attempts = GREATEST(attempts - 1, 0)
            WHERE id = ANY(${sql.param(ids)}::int[]) AND status = 'processing'
        `);
    };
    /** sent 기록 — 일시 DB 오류면 짧게 다시 (HB-3) */
    const markSent = async (ids: number[]) => {
        for (let attempt = 1; ; attempt++) {
            try {
                await db.execute(sql`
                    UPDATE email_health_alerts SET status = 'sent', sent_at = now(), locked_at = NULL, last_error = NULL
                    WHERE id = ANY(${sql.param(ids)}::int[])
                `);
                return;
            } catch (e) {
                if (attempt >= MARK_SENT_TRIES) throw e;
                await sleep(MARK_SENT_RETRY_MS);
            }
        }
    };

    // 15분 넘은 processing 회수 — 보낸 뒤 기록만 실패했을 수 있다 (HB-3). requestId 없이 보내면 시간 초과와 같게 두 번째에서 그치고
    // (같은 글 최대 2통), requestId를 켜면 구글이 중복을 거르니 시도 상한까지 다시 보낸다
    const reclaimCap = idempotent ? ALERT_MAX_ATTEMPTS : UNCERTAIN_MAX_ATTEMPTS;
    await db.execute(sql`
        UPDATE email_health_alerts
        SET status = CASE WHEN attempts >= ${reclaimCap} THEN 'failed' ELSE 'pending' END, locked_at = NULL,
            last_error = CASE WHEN attempts >= ${reclaimCap} THEN ${`${STUCK_ALERT_ERROR} — ${UNCERTAIN_GIVE_UP_NOTE}`} ELSE ${STUCK_ALERT_ERROR} END
        WHERE status = 'processing' AND locked_at < now() - (${STUCK_ALERT_MS}::bigint * INTERVAL '1 millisecond')
    `);
    // 만든 지 24시간 넘은 줄은 보내지 않고 닫는다 (OPS-3) — 웹훅 설정 오류(401·403·404)로 쌓였다가 웹훅을 고치는 순간
    // 지난 보고·이미 풀린 보류 알림이 한꺼번에 지금 일처럼 나가지 않게 (깊이 알림 STALE_AFTER_MS와 같은 규칙).
    // 닫을 때 원인(웹훅 404 등)을 지우지 않고 뒤에 남긴다 (WPN-6)
    const stale = await q<{ id: number }>(sql`
        UPDATE email_health_alerts
        SET status = 'skipped', locked_at = NULL, last_error = ${STALE_ALERT_ERROR}::text || COALESCE(' — 직전: ' || left(last_error, 300), '')
        WHERE status = 'pending' AND created_at < now() - (${STALE_AFTER_MS}::bigint * INTERVAL '1 millisecond')
          ${byKey}
        RETURNING id
    `);
    tally.skipped += stale.length;
    // 같은 조직·받는 곳의 결과 확인 알림이 여러 통 쌓였으면(웹훅이 막혔던 동안) 가장 새 것만 보낸다 (HS-10)
    const superseded = await q<{ id: number }>(sql`
        UPDATE email_health_alerts a SET status = 'skipped', locked_at = NULL, last_error = ${SUPERSEDED}
        WHERE a.status = 'pending' AND a.batch_key LIKE 'sync:%'
          ${opts.batchKey ? sql`AND a.batch_key = ${opts.batchKey}` : sql``}
          AND EXISTS (
              SELECT 1 FROM email_health_alerts b
              WHERE b.org_id = a.org_id AND b.target = a.target AND b.batch_key LIKE 'sync:%' AND b.status = 'pending' AND b.id > a.id
          )
        RETURNING a.id
    `);
    tally.skipped += superseded.length;

    // 이번 회차에 더 쓰지 않을 받는 곳 — 웹훅 설정 오류, 그리고 늦거나 다시 보내도 실패한 곳 (CT-5)
    const broken = new Set<string>();
    let posted = 0;
    type Claimed = { id: number; org_id: string; target: string; batch_key: string; message: string; attempts: number; scheduled_at: string | Date };
    while (Date.now() < deadline) {
        const batch = (
            await q<Claimed>(sql`
                UPDATE email_health_alerts SET status = 'processing', locked_at = now(), attempts = attempts + 1
                WHERE id IN (
                    SELECT id FROM email_health_alerts
                    WHERE status = 'pending' AND scheduled_at <= now()
                      ${byKey}
                      ${broken.size > 0 ? sql`AND target <> ALL(${sql.param([...broken])}::text[])` : sql``}
                    ORDER BY scheduled_at, id
                    LIMIT ${ALERT_PICK}
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, org_id, target, batch_key, message, attempts, scheduled_at
            `)
        )
            // UPDATE … RETURNING은 하위 질의의 순서를 지키지 않는다 — 예약·번호 순으로 다시 세운다 (CT-8·HD-16)
            .sort((a, b) => (toDate(a.scheduled_at)?.getTime() ?? 0) - (toDate(b.scheduled_at)?.getTime() ?? 0) || a.id - b.id);
        if (batch.length === 0) break;
        let i = 0;
        let attempted = false;
        let merged: number[] = [];
        /** 앞 줄의 운영 글에 합쳐 보낸 같은 묶음의 줄 (HS-11) */
        const absorbed = new Set<number>();
        try {
            for (; i < batch.length; i++) {
                attempted = false;
                merged = [];
                const row = batch[i];
                if (absorbed.has(row.id)) continue;
                if (Date.now() >= deadline || broken.has(row.target)) {
                    await release([row.id]);
                    continue;
                }
                const target: "ops" | number = row.target === "ops" ? "ops" : Number(row.target.replace(/^ws:/, ""));
                const hook = healthWebhookInfo(env, target);
                if (!hook.url) {
                    await db.execute(sql`
                        UPDATE email_health_alerts SET status = 'skipped', last_error = ${hook.problem ?? NO_WEBHOOK}, locked_at = NULL WHERE id = ${row.id}::int
                    `);
                    tally.skipped++;
                    continue;
                }
                // 여러 조직이 같은 원인(NHN 키 오류 등)이면 운영 스페이스에 한 통으로 (HS-11). 줄 하나만 보내는 호출(풀림·시험)은 묶지 않는다
                let message = row.message;
                const syncCause = /^sync:(auth|stale|never):/.exec(row.batch_key)?.[1];
                if (row.target === "ops" && syncCause && !opts.batchKey) {
                    // 이번에 함께 집은 줄 가운데 같은 원인의 다른 조직 운영 줄 + 아직 집지 않은 줄
                    const inBatch = batch
                        .slice(i + 1)
                        .filter((r) => r.target === "ops" && r.org_id !== row.org_id && !absorbed.has(r.id) && r.batch_key.startsWith(`sync:${syncCause}:`));
                    for (const r of inBatch) absorbed.add(r.id);
                    const pendingOthers = await q<{ id: number; message: string }>(sql`
                        UPDATE email_health_alerts SET status = 'processing', locked_at = now(), attempts = attempts + 1
                        WHERE id IN (
                            SELECT id FROM email_health_alerts
                            WHERE status = 'pending' AND target = 'ops' AND scheduled_at <= now()
                              AND batch_key LIKE ${`sync:${syncCause}:%`} AND org_id <> ${row.org_id}::uuid
                            ORDER BY id LIMIT 30
                            FOR UPDATE SKIP LOCKED
                        )
                        RETURNING id, message
                    `);
                    const others = [...inBatch.map((r) => ({ id: r.id, message: r.message })), ...pendingOthers];
                    if (others.length > 0) {
                        merged = others.map((o) => o.id);
                        message = mergeSyncAlertTexts([row.message, ...others.map((o) => o.message)]);
                    }
                }
                const ids = [row.id, ...merged];
                if (posted > 0) await sleep(POST_INTERVAL_MS);
                posted++;
                attempted = true;
                const result = await post(hook.url, message, {
                    requestId: chatRequestIdFor(env, "health", row.id),
                    threadKey: chatThreadsEnabled(env) ? healthThreadKey(row.batch_key, row.org_id, row.target) : undefined,
                });
                await recordChatWebhookResult(hook.source, target === "ops" ? null : target, result, hook.url);
                if (result.ok) {
                    await markSent(ids);
                    tally.sent += ids.length;
                    continue;
                }
                const lastError = scrubWebhook(result.error, hook.url).slice(0, 500);
                if (isWebhookConfigError(result.status)) {
                    // 시도로 세지 않고 되돌린다 — 웹훅을 고치면 다음 회차에 나간다. 이번 회차에는 그 받는 곳을 더 쓰지 않는다
                    await db.execute(sql`
                        UPDATE email_health_alerts SET status = 'pending', locked_at = NULL, attempts = GREATEST(attempts - 1, 0),
                               last_error = ${`${WEBHOOK_WAIT_PREFIX}${lastError}`.slice(0, 500)}
                        WHERE id = ANY(${sql.param(ids)}::int[])
                    `);
                    broken.add(row.target);
                    console.warn(`[send-health] 웹훅 설정 오류 target=${row.target} status=${result.status} — 이번 회차는 보내지 않음`);
                    continue;
                }
                // 시간 초과는 구글이 이미 올렸을 수 있다 — requestId 없이 보낼 때는 두 번째 시도에서 그친다 (HB-2)
                const uncertainStop = result.uncertain === true && !idempotent && row.attempts >= UNCERTAIN_MAX_ATTEMPTS;
                if (!result.retryable || row.attempts >= ALERT_MAX_ATTEMPTS || uncertainStop) {
                    const err = uncertainStop ? `${lastError} — ${UNCERTAIN_GIVE_UP_NOTE}`.slice(0, 500) : lastError;
                    await db.execute(sql`UPDATE email_health_alerts SET status = 'failed', last_error = ${err}, locked_at = NULL WHERE id = ANY(${sql.param(ids)}::int[])`);
                    tally.failed += ids.length;
                } else {
                    await db.execute(sql`
                        UPDATE email_health_alerts SET status = 'pending', locked_at = NULL, last_error = ${lastError},
                               scheduled_at = now() + (${ALERT_RETRY_MS}::bigint * INTERVAL '1 millisecond')
                        WHERE id = ANY(${sql.param(ids)}::int[])
                    `);
                    tally.requeued += ids.length;
                }
                // 늦거나 다시 보내도 실패한 받는 곳은 이번 회차에 더 쓰지 않는다 — 다른 받는 곳을 먼저 (CT-5)
                if (result.retryable) broken.add(row.target);
                console.warn(`[send-health] 알림 보내기 실패 id=${row.id} target=${row.target} status=${result.status ?? "-"} attempts=${row.attempts}`);
            }
        } catch (e) {
            // 아직 보내지 않은 줄을 바로 되돌린다 (processing에 15분 묶이지 않게, HB-3). 지금 줄을 이미 보냈다면 그 줄은 15분 뒤 회수가
            // 시도 수를 보고 처리한다
            const rest = [
                ...new Set(
                    attempted
                        ? batch.slice(i + 1).map((r) => r.id).filter((id) => !merged.includes(id))
                        : [...batch.slice(i).map((r) => r.id), ...merged]
                ),
            ];
            await release(rest).catch(() => console.warn(`[send-health] 오류 뒤 되돌리기 실패, ${rest.length}건은 15분 뒤 회수`));
            throw e;
        }
    }
    return tally;
}
