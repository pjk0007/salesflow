import { z } from "zod";
import type { CopyConnection } from "../ai-copy/types";
import { copyTransaction } from "../ai-copy/generation";
import { CopyActionError } from "../ai-copy/errors";
import { fingerprint } from "../ai-copy/rules";
import { analyzeExperiment, DAY_MS } from "./rules";
import type { Assignment, Experiment, ExperimentObservation, ReplyIntent } from "./types";

interface OutcomeRow {
    assignment_id: number;
    source_key: string;
    revision: number;
    event_type: string;
    intent: ReplyIntent | null;
    event_at: Date;
    email_reply_id: number | null;
    evidence: string;
    active: boolean;
}
export async function loadExperimentResults(
    conn: CopyConnection,
    input: { orgId: string; id: number; asOf: Date; connectedReplyAvailable: boolean },
) {
    const [experiment] = await conn<
        Experiment[]
    >`SELECT * FROM email_copy_experiments WHERE id=${input.id} AND org_id=${input.orgId}`;
    if (!experiment) throw new CopyActionError("실험을 찾을 수 없습니다.");
    const assignments = await conn<
        (Assignment & { ready_at: Date | null })[]
    >`SELECT a.*,j.ready_at,
        CASE WHEN a.actual_sent_at IS NOT NULL THEN a.actual_sent_at WHEN l.status='sent' OR l.status='failed' AND l.request_id IS NOT NULL AND (l.nhn_status_code IS NOT NULL OR l.delivery_fail_source IS NOT NULL) THEN l.sent_at ELSE NULL END AS actual_sent_at
        FROM email_copy_assignments a LEFT JOIN ai_copy_generation_jobs j ON j.id=a.generation_job_id LEFT JOIN email_send_logs l ON l.id=a.send_log_id AND l.org_id=a.org_id
        WHERE a.experiment_id=${experiment.id} AND a.org_id=${input.orgId} AND a.assigned_at<=${input.asOf.toISOString()}`;
    const outcomeRows = await conn<
        OutcomeRow[]
    >`SELECT DISTINCT ON(o.assignment_id,o.source_key) o.* FROM email_copy_outcome_revisions o JOIN email_copy_assignments a ON a.id=o.assignment_id
        WHERE a.experiment_id=${experiment.id} AND o.org_id=${input.orgId} AND o.recorded_at<=${input.asOf.toISOString()} ORDER BY o.assignment_id,o.source_key,o.revision DESC`;
    const connected = await conn<
        { assignment_id: number; id: number; received_at: Date }[]
    >`SELECT a.id AS assignment_id,r.id,r.received_at FROM email_replies r
        JOIN email_copy_assignments a ON (r.root_log_id=a.send_log_id OR r.send_log_id=a.send_log_id)
        WHERE a.experiment_id=${experiment.id} AND a.org_id=${input.orgId} AND r.org_id=a.org_id AND r.workspace_id=a.workspace_id
        AND r.kind='human' AND r.match_status='matched' AND r.received_at<=${input.asOf.toISOString()} AND r.detected_at<=${input.asOf.toISOString()}`;
    const unsubscribes = await conn<
        { assignment_id: number }[]
    >`SELECT DISTINCT a.id AS assignment_id FROM email_copy_assignments a JOIN email_unsubscribes u ON u.org_id=a.org_id AND u.workspace_id=a.workspace_id AND lower(trim(u.email))=a.normalized_email
        WHERE a.experiment_id=${experiment.id} AND a.org_id=${input.orgId} AND u.unsubscribed_at>=a.initial_scheduled_at AND u.unsubscribed_at<a.initial_scheduled_at+interval '14 days' AND u.unsubscribed_at<=${input.asOf.toISOString()}`;
    const external = await conn<
        { assignment_id: number }[]
    >`SELECT DISTINCT a.id AS assignment_id FROM email_copy_assignments a JOIN partitions p ON p.workspace_id=a.workspace_id
        JOIN email_send_logs l ON l.partition_id=p.id AND l.org_id=a.org_id AND l.parent_log_id IS NULL AND l.id IS DISTINCT FROM a.send_log_id
        WHERE a.experiment_id=${experiment.id} AND a.org_id=${input.orgId} AND (lower(trim(l.recipient_email))=a.normalized_email
            OR a.company_key IS NOT NULL AND EXISTS(SELECT 1 FROM email_copy_experiment_contacts c WHERE c.org_id=a.org_id AND c.workspace_id=a.workspace_id AND c.company_verified AND c.company_key=a.company_key AND c.normalized_email=lower(trim(l.recipient_email))))
        AND (l.status='sent' OR l.status='failed' AND l.request_id IS NOT NULL AND (l.nhn_status_code IS NOT NULL OR l.delivery_fail_source IS NOT NULL))
        AND l.sent_at>=a.initial_scheduled_at AND l.sent_at<a.initial_scheduled_at+interval '14 days' AND l.sent_at<=${input.asOf.toISOString()}`;
    const outcomesByAssignment = new Map<number, OutcomeRow[]>(),
        connectedByAssignment = new Map<number, (typeof connected)[number][]>();
    for (const row of outcomeRows) {
        const items = outcomesByAssignment.get(row.assignment_id) ?? [];
        items.push(row);
        outcomesByAssignment.set(row.assignment_id, items);
    }
    for (const row of connected) {
        const items = connectedByAssignment.get(row.assignment_id) ?? [];
        items.push(row);
        connectedByAssignment.set(row.assignment_id, items);
    }
    const unsubscribed = new Set(unsubscribes.map((r) => r.assignment_id)),
        contaminated = new Set(external.map((r) => r.assignment_id));
    const rows: ExperimentObservation[] = assignments.map((a) => {
        const outcomes = outcomesByAssignment.get(a.id) ?? [],
            actualReplies = connectedByAssignment.get(a.id) ?? [];
        const replies = new Map<string, { eventAt: Date; intent: ReplyIntent }>();
        for (const r of actualReplies) {
            const override = outcomes.find(
                (o) => o.email_reply_id === r.id || o.source_key === `reply:${r.id}`,
            );
            replies.set(`reply:${r.id}`, {
                eventAt: new Date(r.received_at),
                intent: override?.active ? (override.intent ?? "unknown") : "unknown",
            });
        }
        for (const o of outcomes)
            if (o.active && o.event_type === "human_reply" && !o.email_reply_id)
                replies.set(o.source_key, {
                    eventAt: new Date(o.event_at),
                    intent: o.intent ?? "unknown",
                });
        const inPrimaryWindow = (at: Date) =>
            at >= new Date(a.initial_scheduled_at) &&
            at.getTime() < new Date(a.initial_scheduled_at).getTime() + 14 * DAY_MS &&
            at <= input.asOf;
        return {
            assignmentId: a.id,
            arm: a.arm,
            cohort: a.cohort,
            scheduledAt: new Date(a.initial_scheduled_at),
            sentAt: a.actual_sent_at ? new Date(a.actual_sent_at) : null,
            generated: !!a.ready_at && new Date(a.ready_at) <= input.asOf,
            generationFailed:
                new Date(a.assigned_at).getTime() + 30 * 60_000 <= input.asOf.getTime() &&
                (!a.ready_at ||
                    new Date(a.ready_at).getTime() - new Date(a.assigned_at).getTime() >
                        30 * 60_000),
            unsubscribed:
                unsubscribed.has(a.id) ||
                outcomes.some(
                    (o) =>
                        o.active &&
                        o.event_type === "unsubscribe" &&
                        inPrimaryWindow(new Date(o.event_at)),
                ),
            contaminated:
                contaminated.has(a.id) ||
                outcomes.some(
                    (o) =>
                        o.active &&
                        o.event_type === "external_contact" &&
                        inPrimaryWindow(new Date(o.event_at)),
                ),
            replies: [...replies.values()],
            meetings: outcomes
                .filter((o) => o.active && o.event_type === "meeting")
                .map((o) => new Date(o.event_at)),
        };
    });
    let collectionAvailable = input.connectedReplyAvailable;
    if (experiment.config.replySource === "manual") {
        const [owner] =
            await conn`SELECT u.id FROM users u JOIN organization_members m ON m.user_id=u.id AND m.organization_id=${input.orgId} WHERE u.id=${experiment.config.manualCollectionOwnerId} AND u.is_active=1`;
        collectionAvailable = !!owner;
    }
    const report = analyzeExperiment({
        config: experiment.config,
        rows,
        state: experiment.state,
        startedAt: experiment.started_at ? new Date(experiment.started_at) : null,
        enrollmentClosedAt: experiment.enrollment_closed_at
            ? new Date(experiment.enrollment_closed_at)
            : null,
        asOf: input.asOf,
        collectionAvailable,
    });
    if (experiment.invalidation_reason) {
        report.blocks.push(experiment.invalidation_reason);
        report.canAdopt = false;
        report.decision = "undetermined";
        report.label = "판단 보류";
    }
    const costs = await conn<
        { arm: string; attempts: number; cost_krw: string | null; cost_known: boolean }[]
    >`SELECT a.arm,count(t.id)::int AS attempts,sum(t.cost_krw) AS cost_krw,
        count(t.id)>0 AND bool_and(t.usage_known AND t.cost_krw IS NOT NULL) AS cost_known FROM email_copy_assignments a
        LEFT JOIN ai_copy_generation_jobs j ON j.id=a.generation_job_id LEFT JOIN ai_copy_generation_attempts t ON t.job_id=j.id AND t.started_at<=${input.asOf.toISOString()}
        WHERE a.experiment_id=${experiment.id} AND a.org_id=${input.orgId} GROUP BY a.arm`;
    const senderGroups =
        await conn`SELECT arm,planned_sender_id,actual_sender_id,planned_sender_email,actual_sender_email,tier,count(*)::int AS assigned,
        count(send_log_id)::int AS delivery_started FROM email_copy_assignments WHERE experiment_id=${experiment.id} AND org_id=${input.orgId} GROUP BY arm,planned_sender_id,actual_sender_id,planned_sender_email,actual_sender_email,tier ORDER BY planned_sender_id,arm`;
    return {
        experiment,
        report,
        costs,
        senderGroups,
        senderChanges: assignments.filter(
            (a) =>
                a.actual_sender_id !== null &&
                (a.actual_sender_id !== a.planned_sender_id ||
                    (a.actual_sender_email !== null &&
                        a.planned_sender_email !== null &&
                        a.actual_sender_email !== a.planned_sender_email)),
        ).length,
        collection: {
            method: experiment.config.replySource,
            available: collectionAvailable,
            ownerId: experiment.config.manualCollectionOwnerId,
        },
        metricExplanation:
            "첫 예정 시각부터 14일이 지난 배정 고객 전체를 기준으로 계산합니다. 생성·발송 실패 고객도 분모에 남습니다.",
    };
}
export const outcomeInputSchema = z
    .object({
        assignmentId: z.number().int().positive(),
        sourceKey: z.string().trim().min(1).max(200),
        eventType: z.enum(["human_reply", "meeting", "unsubscribe", "external_contact"]),
        intent: z.enum(["interested", "neutral", "rejected", "unknown"]).nullable(),
        eventAt: z.iso.datetime(),
        emailReplyId: z.number().int().positive().nullable(),
        evidence: z.string().trim().min(10).max(2000),
        active: z.boolean(),
    })
    .refine(
        (v) => v.eventType !== "human_reply" || v.intent !== null,
        "사람 회신의 관심 여부를 선택해 주세요.",
    );
export async function appendOutcomeRevision(
    conn: CopyConnection,
    raw: unknown,
    actor: { orgId: string; userId: string; now: Date },
) {
    const input = outcomeInputSchema.parse(raw);
    if (new Date(input.eventAt) > actor.now)
        throw new CopyActionError("실제 발생한 시각을 기록해 주세요.");
    return copyTransaction(conn, async () => {
        // 채택과 의도 수정이 엇갈리지 않도록 실험 → 배정 순서로 잠근다.
        const [experiment] =
            await conn`SELECT e.id FROM email_copy_experiments e JOIN email_copy_assignments a ON a.experiment_id=e.id WHERE a.id=${input.assignmentId} AND a.org_id=${actor.orgId} FOR UPDATE OF e`;
        if (!experiment) throw new CopyActionError("성과를 기록할 고객을 찾을 수 없습니다.");
        const [assignment] = await conn<
            Assignment[]
        >`SELECT * FROM email_copy_assignments WHERE id=${input.assignmentId} AND org_id=${actor.orgId} FOR UPDATE`;
        if (input.eventType === "human_reply" && !assignment.actual_sent_at)
            throw new CopyActionError("실제 발송이 확인된 고객의 사람 회신만 기록할 수 있습니다.");
        if (input.emailReplyId) {
            const [reply] =
                await conn`SELECT id,received_at FROM email_replies WHERE id=${input.emailReplyId} AND org_id=${actor.orgId} AND workspace_id=${assignment.workspace_id}
                AND (send_log_id=${assignment.send_log_id} OR root_log_id=${assignment.send_log_id}) AND kind='human' AND match_status='matched'`;
            if (!reply || input.eventType !== "human_reply")
                throw new CopyActionError("이 고객에게 연결된 사람 회신을 선택해 주세요.");
            input.eventAt = new Date(reply.received_at).toISOString();
            if (new Date(input.eventAt) > actor.now)
                throw new CopyActionError("실제 발생한 시각을 기록해 주세요.");
        }
        const sourceKey = input.emailReplyId ? `reply:${input.emailReplyId}` : input.sourceKey;
        const [latest] = await conn<
            OutcomeRow[]
        >`SELECT * FROM email_copy_outcome_revisions WHERE assignment_id=${assignment.id} AND source_key=${sourceKey} ORDER BY revision DESC LIMIT 1`;
        const payload = {
            eventType: input.eventType,
            intent: input.intent,
            eventAt: new Date(input.eventAt).toISOString(),
            emailReplyId: input.emailReplyId,
            evidence: input.evidence,
            active: input.active,
        };
        if (
            latest &&
            fingerprint(payload) ===
                fingerprint({
                    eventType: latest.event_type,
                    intent: latest.intent,
                    eventAt: new Date(latest.event_at).toISOString(),
                    emailReplyId: latest.email_reply_id,
                    evidence: latest.evidence,
                    active: latest.active,
                })
        )
            return { revision: latest.revision, unchanged: true };
        const [saved] =
            await conn`INSERT INTO email_copy_outcome_revisions(org_id,assignment_id,source_key,revision,event_type,intent,event_at,email_reply_id,evidence,active,recorded_by,recorded_at)
            VALUES(${actor.orgId},${assignment.id},${sourceKey},${(latest?.revision ?? 0) + 1},${input.eventType},${input.intent},${input.eventAt},${input.emailReplyId},${input.evidence},${input.active},${actor.userId},${actor.now.toISOString()}) RETURNING id,revision`;
        return saved;
    });
}
