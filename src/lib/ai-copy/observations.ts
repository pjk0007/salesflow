import type { CopyConnection, CopyPurpose, CopyOutput, PerformanceTargets } from "./types";
import { copyDiversity, percentile, targetsFor } from "./rules";
import { internalAudienceContains, loadInternalAudience } from "../email-experiments/preview";
import { resolveReplyConfig } from "../email-reply-rules";

export interface ObservedCopy {
    id: number;
    workspace_id: number;
    workspace_name: string;
    purpose: CopyPurpose;
    policy_version_id: number | null;
    policy_name: string | null;
    rule_id: number | null;
    rule_name: string | null;
    assignment_id: number | null;
    superseded_by_id: number | null;
    state: string;
    created_at: Date;
    eligible_at: Date;
    ready_at: Date | null;
    output: CopyOutput | null;
    targets: PerformanceTargets;
    attempts: number;
    validation_failures: number;
    first_result: string | null;
    duration_ms: number | null;
    cost_krw: string | null;
    cost_known: boolean;
    recipient_email: string | null;
    send_log_id: number | null;
    sent_at: Date | null;
    status: string | null;
    replies: { id: number; receivedAt: string }[];
}

const MINUTE = 60_000;
export const OBSERVATION_LIMIT = 5000;
const rate = (n: number, total: number) => (total ? n / total : null);

/** 발송의 지침과 본문을 바꾸지 않고 실제로 기록된 작업만 관찰한다. */
export function summarizeCopyObservations(rows: ObservedCopy[], now: Date) {
    const purposes = (["initial_email", "visit_ack"] as const).map((purpose) => {
        const jobs = rows.filter((r) => r.purpose === purpose);
        const attempted = jobs.filter((r) => r.attempts > 0);
        const settled = jobs.filter(
            (r) =>
                r.state !== "cancelled" &&
                new Date(r.eligible_at).getTime() <= now.getTime() - 30 * MINUTE,
        );
        const ready = jobs.filter((r) => r.ready_at);
        const latency = ready
            .map((r) => new Date(r.ready_at!).getTime() - new Date(r.eligible_at).getTime())
            .filter((ms) => ms >= 0);
        const timely = settled.filter(
            (r) =>
                r.ready_at &&
                new Date(r.ready_at).getTime() - new Date(r.eligible_at).getTime() <= 30 * MINUTE,
        );
        const allCostsKnown =
            attempted.length > 0 && attempted.every((r) => r.cost_known && r.cost_krw !== null);
        return {
            purpose,
            jobs: jobs.length,
            ready: ready.length,
            waiting: jobs.filter((r) => ["pending", "generating", "retry"].includes(r.state))
                .length,
            held: jobs.filter((r) => r.state === "held").length,
            firstAttemptSuccess: rate(
                attempted.filter((r) => r.first_result === "valid").length,
                attempted.length,
            ),
            readyWithin30Minutes: rate(timely.length, settled.length),
            settledJobs: settled.length,
            p95ReadyMs: percentile(latency, 0.95),
            p99ReadyMs: percentile(latency, 0.99),
            latencySamples: latency.length,
            diversity: copyDiversity(ready.flatMap((r) => (r.output ? [r.output] : []))),
            costKrw: allCostsKnown
                ? attempted.reduce((sum, r) => sum + Number(r.cost_krw), 0)
                : null,
            unknownCostJobs: attempted.filter((r) => !r.cost_known || r.cost_krw === null).length,
            targets: targetsFor(purpose),
        };
    });
    const groups = new Map<
        string,
        {
            workspaceId: number;
            workspaceName: string;
            ruleId: number | null;
            ruleName: string | null;
            policyId: number | null;
            policyName: string | null;
            generated: number;
            sent: number;
            matured: number;
            humanReplies: number;
            awaitingObservation: number;
            _customers: Set<string>;
        }
    >();
    // 같은 규칙·지침으로 여러 번 보낸 고객은 첫 발송 한 번만 분모에 넣는다.
    for (const row of [...rows].sort(
        (a, b) =>
            new Date(a.sent_at ?? a.created_at).getTime() -
            new Date(b.sent_at ?? b.created_at).getTime(),
    )) {
        if (row.purpose !== "initial_email" || row.assignment_id || row.superseded_by_id) continue;
        const key = `${row.workspace_id}:${row.rule_id ?? 0}:${row.policy_version_id ?? 0}`;
        let group = groups.get(key);
        if (!group) {
            group = {
                workspaceId: row.workspace_id,
                workspaceName: row.workspace_name,
                ruleId: row.rule_id,
                ruleName: row.rule_name,
                policyId: row.policy_version_id,
                policyName: row.policy_name,
                generated: 0,
                sent: 0,
                matured: 0,
                humanReplies: 0,
                awaitingObservation: 0,
                _customers: new Set(),
            };
            groups.set(key, group);
        }
        if (row.ready_at) group.generated++;
        if (!row.sent_at || !row.recipient_email) continue;
        const email = row.recipient_email.trim().toLowerCase();
        if (group._customers.has(email)) continue;
        group._customers.add(email);
        group.sent++;
        const at = new Date(row.sent_at).getTime(),
            end = at + 14 * 24 * 60 * MINUTE;
        if (end > now.getTime()) {
            group.awaitingObservation++;
            continue;
        }
        group.matured++;
        if (
            row.replies.some(
                (r) =>
                    new Date(r.receivedAt).getTime() >= at &&
                    new Date(r.receivedAt).getTime() < end &&
                    new Date(r.receivedAt) <= now,
            )
        )
            group.humanReplies++;
    }
    return {
        purposes,
        groups: [...groups.values()].map((group) => ({
            workspaceId: group.workspaceId,
            workspaceName: group.workspaceName,
            ruleId: group.ruleId,
            ruleName: group.ruleName,
            policyId: group.policyId,
            policyName: group.policyName,
            generated: group.generated,
            sent: group.sent,
            matured: group.matured,
            humanReplies: group.humanReplies,
            awaitingObservation: group.awaitingObservation,
            humanReplyRate: rate(group.humanReplies, group.matured),
        })),
    };
}

export async function loadCopyObservations(
    conn: CopyConnection,
    input: {
        orgId: string;
        workspaceId: number;
        days: number;
        now: Date;
        internalDomains?: string[];
    },
) {
    const since = new Date(input.now.getTime() - input.days * 24 * 60 * MINUTE);
    const rows = await conn<
        ObservedCopy[]
    >`SELECT j.id,j.workspace_id,w.name AS workspace_name,j.purpose,j.policy_version_id,p.name AS policy_name,
        COALESCE(l.auto_personalized_link_id,e.rule_id,
            CASE WHEN j.idempotency_key ~ '^initial:[0-9]+:' THEN split_part(j.idempotency_key,':',2)::int ELSE NULL END) AS rule_id,
        rl.name AS rule_name,j.assignment_id,j.superseded_by_id,j.state,j.created_at,j.eligible_at,j.ready_at,j.output,
        j.policy_snapshot->'targets' AS targets,j.attempts,j.validation_failures,
        (SELECT t.result FROM ai_copy_generation_attempts t WHERE t.job_id=j.id AND t.attempt_number=1) AS first_result,
        (SELECT sum(t.duration_ms) FROM ai_copy_generation_attempts t WHERE t.job_id=j.id) AS duration_ms,
        (SELECT sum(t.cost_krw) FROM ai_copy_generation_attempts t WHERE t.job_id=j.id) AS cost_krw,
        j.attempts>0 AND NOT EXISTS(SELECT 1 FROM ai_copy_generation_attempts t WHERE t.job_id=j.id AND (NOT t.usage_known OR t.cost_krw IS NULL)) AS cost_known,
        l.recipient_email,j.send_log_id,l.status,
        CASE WHEN l.status IN('sent','delivered') OR l.status='failed' AND l.request_id IS NOT NULL AND (l.nhn_status_code IS NOT NULL OR l.delivery_fail_source IS NOT NULL) THEN l.sent_at ELSE NULL END AS sent_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'receivedAt',r.received_at)) FROM email_replies r WHERE r.org_id=j.org_id AND r.workspace_id=j.workspace_id
            AND (r.root_log_id=l.id OR r.send_log_id=l.id) AND r.kind='human' AND r.match_status='matched' AND r.detected_mode='on' AND r.detected_at<=${input.now.toISOString()} AND r.received_at<=${input.now.toISOString()}),'[]'::jsonb) AS replies
        FROM ai_copy_generation_jobs j JOIN workspaces w ON w.id=j.workspace_id AND w.org_id=j.org_id
        LEFT JOIN ai_copy_policy_versions p ON p.id=j.policy_version_id AND p.org_id=j.org_id
        LEFT JOIN email_send_logs l ON l.id=j.send_log_id AND l.org_id=j.org_id
        LEFT JOIN email_copy_assignments a ON a.id=j.assignment_id AND a.org_id=j.org_id
        LEFT JOIN email_copy_experiments e ON e.id=a.experiment_id AND e.org_id=j.org_id
        LEFT JOIN email_auto_personalized_links rl ON rl.id=COALESCE(l.auto_personalized_link_id,e.rule_id,
            CASE WHEN j.idempotency_key ~ '^initial:[0-9]+:' THEN split_part(j.idempotency_key,':',2)::int ELSE NULL END) AND rl.org_id=j.org_id
        WHERE j.org_id=${input.orgId} AND (${input.workspaceId}=0 OR j.workspace_id=${input.workspaceId})
            AND j.created_at>=${since.toISOString()} AND j.created_at<=${input.now.toISOString()}
            AND j.origin IN('operational','replacement')
        ORDER BY j.created_at DESC,j.id DESC LIMIT ${OBSERVATION_LIMIT + 1}`;
    const audience = await loadInternalAudience(conn, input.orgId, input.internalDomains);
    const source = rows.slice(0, OBSERVATION_LIMIT);
    const customers = source.filter(
        (r) => !r.recipient_email || !internalAudienceContains(audience, r.recipient_email),
    );
    const summary = summarizeCopyObservations(customers, input.now);
    const config = resolveReplyConfig(process.env);
    let mailboxReady = false;
    if (config.syncMode === "on" && config.credentials && !config.readBlockedReason) {
        const [state] = await conn<
            {
                last_success_at: Date | null;
                last_error_at: Date | null;
                backfill_done_at: Date | null;
            }[]
        >`SELECT last_success_at,last_error_at,backfill_done_at FROM email_reply_mailbox_state WHERE mailbox=${config.mailbox}`;
        mailboxReady =
            !!state?.last_success_at &&
            !!state.backfill_done_at &&
            input.now.getTime() - new Date(state.last_success_at).getTime() <= 15 * MINUTE &&
            (!state.last_error_at ||
                new Date(state.last_error_at) <= new Date(state.last_success_at));
    }
    return {
        ...summary,
        groups: summary.groups.map((g) => ({
            ...g,
            replyConnected: mailboxReady && config.workspaceIds.includes(g.workspaceId),
        })),
        asOf: input.now.toISOString(),
        since: since.toISOString(),
        days: input.days,
        observedJobs: customers.length,
        excludedInternal: source.length - customers.length,
        experimentJobs: customers.filter((r) => r.assignment_id !== null).length,
        truncated: rows.length > OBSERVATION_LIMIT,
        limit: OBSERVATION_LIMIT,
    };
}

export type CopyObservations = Awaited<ReturnType<typeof loadCopyObservations>>;
