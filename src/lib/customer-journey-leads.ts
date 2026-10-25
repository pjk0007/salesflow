/** CRM은 Chat과 같은 저장 판정을 읽고, 현재의 내부·공유·완료·짧은 방문 조건을 다시 확인한다. */
import type { queryClient } from "./db";
import { summarizeJourney } from "./customer-journey-card";
import { enrichedInput, loadCandidates } from "./customer-journey-source";
import { journeyAlertConfig } from "./customer-journey-alert-config";
import { journeyOwner } from "./customer-journey-owner";
import type { JourneyPriority } from "./customer-journey-priority";
import type { AssessedLead, LeadFollowup } from "../components/lead-followup/types";

export type JourneyConnection = Awaited<ReturnType<typeof queryClient.reserve>>;
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
export const emptyFollowup = (): LeadFollowup => ({ status: "new", dueAt: null, note: "", revision: 0,
    updatedAt: null, updatedBy: null, lastRemindedAt: null, reminderCount: 0 });
export function jsonValue<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }

/** 한 번에 읽는 판정 줄 수와 한 요청에서 다시 확인할 최대 줄 수 — 제외 대상이 많아도 무한히 읽지 않는다 */
export const LEAD_BATCH_SIZE = 50;
export const LEAD_MAX_SCANNED = 500;

/**
 * 정렬된 묶음을 커서로 이어 읽어 유효한 결과를 limit까지 채운다 (UX-214).
 * 앞 묶음이 모두 제외돼도 다음 묶음을 읽고, 묶음이 덜 차면(더 없음) 또는 maxScanned에 닿으면 멈춘다.
 */
export async function fillFromBatches<R, T>(
    fetchBatch: (after: R | null, size: number) => Promise<R[]>,
    accept: (row: R) => Promise<T | null>,
    limit: number,
    opts: { batchSize?: number; maxScanned?: number } = {},
): Promise<{ items: T[]; scanned: number; exhausted: boolean }> {
    const batchSize = Math.max(1, opts.batchSize ?? LEAD_BATCH_SIZE);
    const maxScanned = Math.max(batchSize, opts.maxScanned ?? LEAD_MAX_SCANNED);
    const items: T[] = [];
    let after: R | null = null, scanned = 0;
    while (items.length < limit && scanned < maxScanned) {
        const size = Math.min(batchSize, maxScanned - scanned);
        const rows = await fetchBatch(after, size);
        for (const row of rows) {
            scanned++;
            const item = await accept(row);
            if (item !== null) items.push(item);
            if (items.length >= limit) return { items, scanned, exhausted: false };
        }
        if (rows.length < size) return { items, scanned, exhausted: true };
        after = rows[rows.length - 1];
    }
    return { items, scanned, exhausted: false };
}

type AlertRow = { id: number; workspace_id: number; record_id: number; session_id: number; message: Record<string, unknown> | string; created_at: Date };
type AssessedRow = AlertRow & { tier_rank: number; cursor_at: string };

/** 사업·고객 키의 후속 대응 상태 (없으면 null) */
export async function loadFollowupState(conn: JourneyConnection, orgId: string, workspaceId: number, customerKey: string): Promise<LeadFollowup | null> {
    const [state] = await conn<{ data: LeadFollowup }[]>`SELECT json_build_object(
        'status',status,'dueAt',due_at,'note',note,'revision',revision,'updatedAt',updated_at,
        'updatedBy',updated_by_name,'lastRemindedAt',last_reminded_at,'reminderCount',reminder_count) AS data
        FROM journey_lead_followups WHERE org_id=${orgId} AND workspace_id=${workspaceId} AND customer_key=${customerKey}`;
    return state ? jsonValue(state.data) : null;
}

/**
 * 저장한 판정 한 줄을 지금 자료로 다시 확인한다 — 목록(listAssessedLeads)과 제외 이유 설명(explainLeadExclusion)이 같은 규칙을 쓴다.
 */
async function checkLeadRow(conn: JourneyConnection, row: AlertRow, ctx: {
    orgId: string; now: Date; since: string; env: Record<string, string | undefined>;
}): Promise<{ lead: AssessedLead; reason: null } | { lead: null; reason: string }> {
    const priority = jsonValue(row.message).journeyPriority as JourneyPriority;
    const [target] = await loadCandidates(conn, row.workspace_id, ctx.now, new Date(ctx.since), { sessionId: row.session_id, orgId: ctx.orgId });
    if (!target) return { lead: null, reason: "판정한 방문 기록을 지금 다시 확인할 수 없습니다." };
    const config = journeyAlertConfig(ctx.env);
    const input = await enrichedInput(conn, target, config.baseUrl, ctx.now, [], (ctx.env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","));
    const summary = summarizeJourney(input, ctx.now);
    if (summary.completed) return { lead: null, reason: "고객이 신청·구매를 완료했습니다." };
    if (!summary.eligible) return { lead: null, reason: summary.priority.excludedReason ?? "현재 판정 조건(방문 진행 중·자동 방문 의심 등)에 해당하지 않습니다." };
    if (!priority.rankEligible) return { lead: null, reason: priority.excludedReason ?? "제외 조건에 해당합니다." };
    const followup = await loadFollowupState(conn, ctx.orgId, row.workspace_id, priority.customerKey);
    return { reason: null, lead: { alertId: row.id, recordId: row.record_id, workspaceId: row.workspace_id, customerKey: priority.customerKey,
        businessName: input.businessName, company: summary.company, person: summary.person, email: input.recipientEmail,
        stage: summary.stage, totalSeconds: summary.totalSeconds, assessedAt: new Date(row.created_at).toISOString(),
        priority, ownerName: journeyOwner(config.routes[row.workspace_id])?.name ?? null,
        followup: followup ?? emptyFollowup() } };
}

/**
 * 이 레코드에 유효한 판정이 없을 때 그 이유 (UX-278). 마지막 판정 줄을 기간·저장 판정·현재 자료 순으로 본다.
 */
export async function explainLeadExclusion(conn: JourneyConnection, opts: {
    orgId: string; recordId: number; now?: Date; env?: Record<string, string | undefined>;
}): Promise<string> {
    const now = opts.now ?? new Date(), env = opts.env ?? process.env;
    const since = new Date(now.getTime() - DAYS_30).toISOString();
    const [row] = await conn<(AlertRow & { status: string; last_error: string | null })[]>`
        SELECT id,workspace_id,record_id,session_id,message,created_at,status,last_error FROM customer_journey_alerts
        WHERE org_id=${opts.orgId} AND record_id=${opts.recordId} ORDER BY last_activity_at DESC, id DESC LIMIT 1`;
    if (!row) return "이 고객의 메일 유입 여정 판정 기록이 없습니다.";
    if (new Date(row.created_at).getTime() < Date.parse(since)) return "마지막 판정 후 30일이 지나 핵심 리드 판정에서 빠졌습니다.";
    const priority = (jsonValue(row.message) as { journeyPriority?: JourneyPriority }).journeyPriority;
    if (row.status === "skipped") return row.last_error ? `판정에서 제외됐습니다: ${row.last_error}` : "판정에서 제외됐습니다.";
    if (!priority || priority.version !== 1) return "이전 형식의 판정이라 다시 확인할 수 없습니다.";
    if (!priority.rankEligible) return priority.excludedReason ?? "제외 조건(내부·공유·완료 등)에 해당합니다.";
    const checked = await checkLeadRow(conn, row, { orgId: opts.orgId, now, since, env });
    return checked.reason ?? "현재 유효한 판정이 있습니다. 화면을 새로 고쳐 주세요.";
}

export async function listAssessedLeads(conn: JourneyConnection, opts: {
    orgId: string; workspaceId?: number; recordId?: number; limit?: number; now?: Date;
    env?: Record<string, string | undefined>; includeNormal?: boolean;
}): Promise<AssessedLead[]> {
    const now = opts.now ?? new Date(), env = opts.env ?? process.env;
    const since = new Date(now.getTime() - DAYS_30).toISOString();
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    // 정렬: 긴급 먼저 → 최근 활동 → id (동률 고정). 커서는 마지막 줄의 (tier_rank, last_activity_at, id).
    // last_activity_at은 같은 세션 안에서 text로 왕복해 마이크로초까지 그대로 비교한다.
    const fetchBatch = (after: AssessedRow | null, size: number) => conn<AssessedRow[]>`
        WITH assessed AS (
            SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.workspace_id, a.message->'journeyPriority'->>'customerKey'
                ORDER BY a.last_activity_at DESC, a.id DESC) AS rn
            FROM customer_journey_alerts a JOIN workspaces w ON w.id=a.workspace_id AND w.org_id=a.org_id
            JOIN records r ON r.id=a.record_id AND r.org_id=a.org_id AND r.workspace_id=a.workspace_id
            WHERE a.org_id=${opts.orgId} AND a.created_at>=${since} AND a.created_at<=${now.toISOString()}
                AND a.status <> 'skipped' AND a.message->'journeyPriority'->>'version'='1'
                AND a.message->'journeyPriority'->>'rankEligible'='true'
                AND (${opts.workspaceId ?? null}::int IS NULL OR a.workspace_id=${opts.workspaceId ?? null})
                AND (${opts.recordId ?? null}::int IS NULL OR EXISTS (
                    SELECT 1 FROM customer_journey_alerts old JOIN records target ON target.id=old.record_id
                    WHERE old.record_id=${opts.recordId ?? null} AND old.org_id=a.org_id AND old.workspace_id=a.workspace_id
                        AND target.org_id=a.org_id AND target.workspace_id=a.workspace_id
                        AND old.message->'journeyPriority'->>'customerKey'=a.message->'journeyPriority'->>'customerKey'))
        ), ranked AS (
            SELECT id,workspace_id,record_id,session_id,message,created_at,last_activity_at,
                CASE WHEN message->'journeyPriority'->>'tier'='urgent' THEN 0 ELSE 1 END AS tier_rank
            FROM assessed WHERE rn=1
                AND (${opts.includeNormal === true} OR message->'journeyPriority'->>'tier' IN ('highlight','urgent'))
        ) SELECT id,workspace_id,record_id,session_id,message,created_at,tier_rank,last_activity_at::text AS cursor_at FROM ranked
        WHERE ${after === null} OR tier_rank > ${after?.tier_rank ?? 0}
            OR (tier_rank = ${after?.tier_rank ?? 0} AND (last_activity_at < ${after?.cursor_at ?? null}::timestamptz
                OR (last_activity_at = ${after?.cursor_at ?? null}::timestamptz AND id < ${after?.id ?? 0})))
        ORDER BY tier_rank, last_activity_at DESC, id DESC
        LIMIT ${size}`;
    // 목록을 읽은 뒤 완료·내부·공유·짧은 방문으로 바뀐 고객은 빼고, 그만큼 다음 묶음에서 채운다.
    const accept = async (row: AssessedRow): Promise<AssessedLead | null> =>
        (await checkLeadRow(conn, row, { orgId: opts.orgId, now, since, env })).lead;
    const { items } = await fillFromBatches(fetchBatch, accept, limit, { batchSize: Math.max(limit, LEAD_BATCH_SIZE) });
    return items;
}
