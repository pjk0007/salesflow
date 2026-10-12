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

export async function listAssessedLeads(conn: JourneyConnection, opts: {
    orgId: string; workspaceId?: number; recordId?: number; limit?: number; now?: Date;
    env?: Record<string, string | undefined>; includeNormal?: boolean;
}): Promise<AssessedLead[]> {
    const now = opts.now ?? new Date(), env = opts.env ?? process.env;
    const since = new Date(now.getTime() - DAYS_30).toISOString();
    const routes = journeyAlertConfig(env).routes;
    const rows = await conn<{ id: number; workspace_id: number; record_id: number; session_id: number; message: Record<string, unknown> | string; created_at: Date }[]>`
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
        ) SELECT id,workspace_id,record_id,session_id,message,created_at FROM assessed WHERE rn=1
            AND (${opts.includeNormal === true} OR message->'journeyPriority'->>'tier' IN ('highlight','urgent'))
        ORDER BY CASE WHEN message->'journeyPriority'->>'tier'='urgent' THEN 0 ELSE 1 END, last_activity_at DESC
        LIMIT ${Math.max(1, Math.min(opts.limit ?? 50, 200))}`;
    const leads: AssessedLead[] = [];
    for (const row of rows) {
        const priority = jsonValue(row.message).journeyPriority as JourneyPriority;
        const [target] = await loadCandidates(conn, row.workspace_id, now, new Date(since), { sessionId: row.session_id, orgId: opts.orgId });
        if (!target) continue;
        const input = await enrichedInput(conn, target, journeyAlertConfig(env).baseUrl, now, [], (env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","));
        const summary = summarizeJourney(input, now);
        if (!summary.eligible || summary.completed || !priority.rankEligible) continue;
        const [state] = await conn<{ data: LeadFollowup }[]>`SELECT json_build_object(
            'status',status,'dueAt',due_at,'note',note,'revision',revision,'updatedAt',updated_at,
            'updatedBy',updated_by_name,'lastRemindedAt',last_reminded_at,'reminderCount',reminder_count) AS data
            FROM journey_lead_followups WHERE org_id=${opts.orgId} AND workspace_id=${row.workspace_id} AND customer_key=${priority.customerKey}`;
        leads.push({ alertId: row.id, recordId: row.record_id, workspaceId: row.workspace_id, customerKey: priority.customerKey,
            businessName: input.businessName, company: summary.company, person: summary.person, email: input.recipientEmail,
            stage: summary.stage, totalSeconds: summary.totalSeconds, assessedAt: new Date(row.created_at).toISOString(),
            priority, ownerName: journeyOwner(routes[row.workspace_id])?.name ?? null,
            followup: state ? jsonValue(state.data) : emptyFollowup() });
    }
    return leads;
}
