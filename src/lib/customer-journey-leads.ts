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

type AssessedRow = { id: number; workspace_id: number; record_id: number; session_id: number; message: Record<string, unknown> | string;
    created_at: Date; tier_rank: number; cursor_at: string };

export async function listAssessedLeads(conn: JourneyConnection, opts: {
    orgId: string; workspaceId?: number; recordId?: number; limit?: number; now?: Date;
    env?: Record<string, string | undefined>; includeNormal?: boolean;
}): Promise<AssessedLead[]> {
    const now = opts.now ?? new Date(), env = opts.env ?? process.env;
    const since = new Date(now.getTime() - DAYS_30).toISOString();
    const routes = journeyAlertConfig(env).routes;
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
    const accept = async (row: AssessedRow): Promise<AssessedLead | null> => {
        const priority = jsonValue(row.message).journeyPriority as JourneyPriority;
        const [target] = await loadCandidates(conn, row.workspace_id, now, new Date(since), { sessionId: row.session_id, orgId: opts.orgId });
        if (!target) return null;
        const input = await enrichedInput(conn, target, journeyAlertConfig(env).baseUrl, now, [], (env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","));
        const summary = summarizeJourney(input, now);
        if (!summary.eligible || summary.completed || !priority.rankEligible) return null;
        const [state] = await conn<{ data: LeadFollowup }[]>`SELECT json_build_object(
            'status',status,'dueAt',due_at,'note',note,'revision',revision,'updatedAt',updated_at,
            'updatedBy',updated_by_name,'lastRemindedAt',last_reminded_at,'reminderCount',reminder_count) AS data
            FROM journey_lead_followups WHERE org_id=${opts.orgId} AND workspace_id=${row.workspace_id} AND customer_key=${priority.customerKey}`;
        return { alertId: row.id, recordId: row.record_id, workspaceId: row.workspace_id, customerKey: priority.customerKey,
            businessName: input.businessName, company: summary.company, person: summary.person, email: input.recipientEmail,
            stage: summary.stage, totalSeconds: summary.totalSeconds, assessedAt: new Date(row.created_at).toISOString(),
            priority, ownerName: journeyOwner(routes[row.workspace_id])?.name ?? null,
            followup: state ? jsonValue(state.data) : emptyFollowup() };
    };
    const { items } = await fillFromBatches(fetchBatch, accept, limit, { batchSize: Math.max(limit, LEAD_BATCH_SIZE) });
    return items;
}
