import { FOLLOWUP_LABELS, type AssessedLead, type FollowupDetail, type FollowupHistory, type FollowupPatch } from "../components/lead-followup/types";
import { jsonValue, listAssessedLeads, type JourneyConnection } from "./customer-journey-leads";
import { FOLLOWUP_DAY_MS, shouldRemindLead } from "./customer-journey-followup-rules";
import { buildJourneyCard, summarizeJourney } from "./customer-journey-card";
import { enrichedInput, loadCandidates } from "./customer-journey-source";
import { journeyOwner } from "./customer-journey-owner";
import { journeyAlertConfig } from "./customer-journey-alert-config";
import { postGoogleChatMessage } from "./google-chat";
import { isBusinessHours } from "./kst";

export class LeadFollowupError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
export async function ensureLeadFollowup(conn: JourneyConnection, target: {
    orgId: string; workspaceId: number; recordId: number; customerKey: string; urgent: boolean; assessedAt: Date;
}, now: Date) {
    await conn`INSERT INTO journey_lead_followups (org_id,workspace_id,customer_key,record_id,first_urgent_at,created_at,updated_at,next_reminder_check_at)
        VALUES (${target.orgId},${target.workspaceId},${target.customerKey},${target.recordId},
            ${target.urgent ? target.assessedAt.toISOString() : null},${now.toISOString()},${now.toISOString()},${now.toISOString()})
        ON CONFLICT (org_id,workspace_id,customer_key) DO UPDATE SET record_id=EXCLUDED.record_id,
            first_urgent_at=COALESCE(journey_lead_followups.first_urgent_at,EXCLUDED.first_urgent_at)`;
}

export async function getLeadFollowup(conn: JourneyConnection, orgId: string, recordId: number, now = new Date(), env = process.env): Promise<FollowupDetail> {
    const [record] = await conn`SELECT id FROM records WHERE id=${recordId} AND org_id=${orgId}`;
    if (!record) throw new LeadFollowupError("고객을 찾을 수 없습니다.", 404);
    const [lead] = await listAssessedLeads(conn, { orgId, recordId, now, env, includeNormal: true, limit: 1 });
    if (!lead) return { lead: null, history: [] };
    const history = await conn<{ at: Date; meta: Record<string, unknown> | string }[]>`
        SELECT occurred_at AS at,meta FROM record_events WHERE org_id=${orgId} AND type='lead_followup'
            AND meta->>'workspaceId'=${String(lead.workspaceId)} AND meta->>'customerKey'=${lead.customerKey}
        ORDER BY occurred_at DESC,id DESC LIMIT 20`;
    return { lead, history: history.map((h) => ({ at: new Date(h.at).toISOString(), ...jsonValue(h.meta) })) as FollowupHistory[] };
}

export async function saveLeadFollowup(conn: JourneyConnection, actor: { orgId: string; userId: string; name: string }, recordId: number,
    patch: FollowupPatch, now = new Date(), env = process.env): Promise<FollowupDetail> {
    const { lead } = await getLeadFollowup(conn, actor.orgId, recordId, now, env);
    if (!lead) throw new LeadFollowupError("유효한 고객 여정 판정이 아직 없습니다.", 404);
    await ensureLeadFollowup(conn, { orgId: actor.orgId, workspaceId: lead.workspaceId, recordId: lead.recordId,
        customerKey: lead.customerKey, urgent: lead.priority.tier === "urgent", assessedAt: new Date(lead.assessedAt) }, now);
    const meta = { workspaceId: lead.workspaceId, customerKey: lead.customerKey,
        status: patch.status, dueAt: patch.dueAt, note: patch.note, actorName: actor.name };
    // 상태 갱신과 CRM 이력은 한 문장으로 확정한다. 같은 화면을 연 다른 담당자의 변경을 덮지 않는다.
    const changed = await conn`WITH changed AS (
        UPDATE journey_lead_followups SET status=${patch.status},due_at=${patch.dueAt},note=${patch.note},
            revision=revision+1,updated_by=${actor.userId},updated_by_name=${actor.name},updated_at=${now.toISOString()},next_reminder_check_at=${now.toISOString()}
        WHERE org_id=${actor.orgId} AND workspace_id=${lead.workspaceId} AND customer_key=${lead.customerKey}
            AND revision=${patch.revision} RETURNING *
    ), logged AS (
        INSERT INTO record_events (org_id,record_id,type,label,occurred_at,meta)
        SELECT org_id,record_id,'lead_followup',${FOLLOWUP_LABELS[patch.status]},${now.toISOString()},${JSON.stringify(meta)}::jsonb
        FROM changed RETURNING id
    ) SELECT changed.id FROM changed CROSS JOIN logged`;
    if (!changed.length) throw new LeadFollowupError("다른 담당자가 먼저 수정했습니다. 최신 상태를 불러온 뒤 다시 저장해 주세요.", 409);
    return getLeadFollowup(conn, actor.orgId, recordId, now, env);
}

export async function lastJourneyMention(conn: JourneyConnection, orgId: string, workspaceId: number, customerKey: string): Promise<string | null> {
    const [row] = await conn<{ last_at: Date | null }[]>`SELECT MAX(at) AS last_at FROM (
        SELECT COALESCE((message->'journeyPriority'->>'ownerMentionedAt')::timestamptz,sent_at,created_at) AS at
        FROM customer_journey_alerts WHERE org_id=${orgId} AND workspace_id=${workspaceId}
            AND status IN ('sent','uncertain') AND message->'journeyPriority'->>'ownerMentioned'='true'
            AND message->'journeyPriority'->>'customerKey'=${customerKey}
        UNION ALL SELECT last_reminded_at FROM journey_lead_followups WHERE org_id=${orgId}
            AND workspace_id=${workspaceId} AND customer_key=${customerKey}
    ) mentions`;
    return row?.last_at ? new Date(row.last_at).toISOString() : null;
}

export async function processLeadReminders(conn: JourneyConnection, opts: {
    env: Record<string, string | undefined>; now: Date; post?: typeof postGoogleChatMessage;
}) {
    const { env, now } = opts, config = journeyAlertConfig(env);
    const stats = { reminded: 0, reminderFailed: 0 };
    if (config.mode !== "live" || !isBusinessHours(now) || !config.readyIds.length) return stats;
    const cutoff = new Date(now.getTime() - FOLLOWUP_DAY_MS).toISOString();
    const due = await conn<{ id: number; org_id: string; workspace_id: number; record_id: number; customer_key: string; first_urgent_at: Date }[]>`
        SELECT f.id,f.org_id,f.workspace_id,f.record_id,f.customer_key,f.first_urgent_at
        FROM journey_lead_followups f JOIN workspaces w ON w.id=f.workspace_id AND w.org_id=f.org_id
        WHERE f.workspace_id=ANY(${config.readyIds}) AND f.first_urgent_at IS NOT NULL AND f.reminder_count<3
            AND f.next_reminder_check_at<=${now.toISOString()}
            AND (f.last_reminded_at IS NULL OR f.last_reminded_at<=${cutoff})
            AND ((f.status='new' AND GREATEST(f.first_urgent_at,f.updated_at)<=${cutoff}) OR (f.status='planned' AND f.due_at<=${now.toISOString()}))
        ORDER BY COALESCE(f.due_at,f.first_urgent_at),f.id LIMIT 50`;
    for (const f of due) {
        // 제외된 오래된 50건이 뒤의 정상 고객을 계속 막지 않게 다음 검사를 미룬다.
        await conn`UPDATE journey_lead_followups SET next_reminder_check_at=${new Date(now.getTime() + 3600_000).toISOString()} WHERE id=${f.id} AND org_id=${f.org_id}`;
        const [lead] = await listAssessedLeads(conn, { orgId: f.org_id, workspaceId: f.workspace_id, recordId: f.record_id, now, env, limit: 1 });
        if (!lead || lead.customerKey !== f.customer_key) continue;
        const owner = journeyOwner(config.routes[f.workspace_id]);
        if (!owner || !shouldRemindLead({ urgent: lead.priority.tier === "urgent", firstUrgentAt: new Date(f.first_urgent_at).toISOString(),
            followup: lead.followup, lastMentionedAt: await lastJourneyMention(conn, f.org_id, f.workspace_id, f.customer_key) }, now)) continue;
        const [session] = await conn<{ session_id: number }[]>`SELECT session_id FROM customer_journey_alerts WHERE id=${lead.alertId} AND org_id=${f.org_id}`;
        if (!session) continue;
        const [source] = await loadCandidates(conn, f.workspace_id, now, new Date(now.getTime() - 30 * FOLLOWUP_DAY_MS),
            { sessionId: session.session_id, orgId: f.org_id });
        if (!source) continue;
        const input = await enrichedInput(conn, source, config.baseUrl, now, [], (env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","));
        const current = summarizeJourney(input, now);
        if (!current.chatEligible || current.completed) continue;
        // 결과 불명확/프로세스 종료도 같은 날 다시 태그하지 않도록 요청 전에 예약을 확정한다.
        const claimed = await conn`UPDATE journey_lead_followups SET last_reminded_at=${now.toISOString()},reminder_count=reminder_count+1,reminder_result='uncertain'
            WHERE id=${f.id} AND org_id=${f.org_id} AND revision=${lead.followup.revision}
                AND status IN ('new','planned') AND (last_reminded_at IS NULL OR last_reminded_at<=${cutoff}) RETURNING id`;
        if (!claimed.length) continue;
        const [stillOpen] = await conn`SELECT id FROM journey_lead_followups WHERE id=${f.id} AND org_id=${f.org_id}
            AND revision=${lead.followup.revision} AND status IN ('new','planned')`;
        const [freshSource] = await loadCandidates(conn, f.workspace_id, now, new Date(now.getTime() - 30 * FOLLOWUP_DAY_MS),
            { sessionId: session.session_id, orgId: f.org_id });
        const freshInput = freshSource && await enrichedInput(conn, freshSource, config.baseUrl, now, [], (env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","));
        const fresh = freshInput && summarizeJourney(freshInput, now);
        if (!stillOpen || !fresh?.chatEligible || fresh.completed) {
            await conn`UPDATE journey_lead_followups SET reminder_result='cancelled' WHERE id=${f.id} AND org_id=${f.org_id}`;
            continue;
        }
        const message = buildJourneyCard(freshInput!, now, { ownerName: owner.name, state: "tag" }, lead.followup, lead.priority);
        message.text = `후속 대응 재알림 · ${FOLLOWUP_LABELS[lead.followup.status]} | ${message.text}`;
        const result = await (opts.post ?? postGoogleChatMessage)(config.routes[f.workspace_id], message, fetch,
            { threadKey: `customer-journey-${f.org_id}-${f.workspace_id}-${lead.recordId}`, mentionUserId: owner.userId });
        await conn`UPDATE journey_lead_followups SET reminder_result=${result.ok ? "sent" : result.uncertain ? "uncertain" : "failed"} WHERE id=${f.id} AND org_id=${f.org_id}`;
        if (result.ok) stats.reminded++; else stats.reminderFailed++;
    }
    return stats;
}

export async function followupForCard(conn: JourneyConnection, orgId: string, workspaceId: number, customerKey: string): Promise<AssessedLead["followup"] | undefined> {
    const [row] = await conn<{ data: AssessedLead["followup"] }[]>`SELECT json_build_object('status',status,'dueAt',due_at,'note',note,
        'revision',revision,'updatedAt',updated_at,'updatedBy',updated_by_name,'lastRemindedAt',last_reminded_at,'reminderCount',reminder_count) AS data
        FROM journey_lead_followups WHERE org_id=${orgId} AND workspace_id=${workspaceId} AND customer_key=${customerKey}`;
    return row ? jsonValue(row.data) : undefined;
}
