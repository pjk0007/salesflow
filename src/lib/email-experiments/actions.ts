import type { CopyConnection } from "../ai-copy/types";
import { copyTransaction } from "../ai-copy/generation";
import { CopyActionError } from "../ai-copy/errors";
import { bindCopyVersions } from "../ai-copy/versions";
import { loadExperimentResults } from "./results";
import { experimentEvent } from "./repository";
import type { Experiment } from "./types";
export async function adoptExperiment(
    conn: CopyConnection,
    input: {
        orgId: string;
        userId: string;
        id: number;
        now: Date;
        connectedReplyAvailable: boolean;
    },
    insideTransaction = false,
) {
    const apply = async () => {
        const [experiment] = await conn<
            (Experiment & { adopted_policy_id: number | null })[]
        >`SELECT * FROM email_copy_experiments WHERE id=${input.id} AND org_id=${input.orgId} FOR UPDATE`;
        if (!experiment) throw new CopyActionError("실험을 찾을 수 없습니다.");
        if (
            experiment.state === "closed" &&
            experiment.adopted_policy_id === experiment.config.policyBId
        )
            return { adopted: true, unchanged: true };
        if (!["observing", "decision_ready"].includes(experiment.state))
            throw new CopyActionError("관찰이 끝난 실험만 채택할 수 있습니다.");
        const results = await loadExperimentResults(conn, { ...input, asOf: input.now });
        if (!results.report.canAdopt)
            throw new CopyActionError(
                results.report.blocks.join(" / ") || "B의 개선을 확정할 수 없습니다.",
            );
        await bindCopyVersions(
            conn,
            {
                orgId: input.orgId,
                userId: input.userId,
                workspaceId: experiment.workspace_id,
                purpose: "initial_email",
                ruleId: experiment.rule_id,
                policyVersionId: experiment.config.policyBId,
                knowledgeVersionId: experiment.config.knowledgeVersionId,
            },
            true,
        );
        await conn`UPDATE email_copy_experiments SET state='closed',closed_at=${input.now.toISOString()},pending_mode='continue',adopted_policy_id=${experiment.config.policyBId},adopted_by=${input.userId} WHERE id=${experiment.id}`;
        await experimentEvent(conn, {
            ...input,
            experimentId: experiment.id,
            action: "adopted_b",
            detail: { appliesTo: "new_jobs_only", report: results.report, costs: results.costs },
        });
        return { adopted: true, appliesTo: "new_jobs_only" };
    };
    return insideTransaction ? apply() : copyTransaction(conn, apply);
}
/** 새 발송이 없더라도 모집 종료와 14일 성숙 상태를 진행시킨다. 성과를 보고 조기 종료하지 않는다. */
export async function advanceExperimentLifecycles(conn: CopyConnection, now: Date, orgId?: string) {
    return copyTransaction(conn, async () => {
        const changed = await conn<{ id: number; org_id: string; state: string }[]>`WITH counts AS (
        SELECT e.id,count(a.id) FILTER(WHERE a.arm='A' AND a.cohort='primary') AS n_a,count(a.id) FILTER(WHERE a.arm='B' AND a.cohort='primary') AS n_b
        FROM email_copy_experiments e LEFT JOIN email_copy_assignments a ON a.experiment_id=e.id WHERE e.state='running' AND (${orgId ?? null}::uuid IS NULL OR e.org_id=${orgId ?? null}::uuid) GROUP BY e.id
    ) UPDATE email_copy_experiments e SET state=CASE WHEN c.n_a>=(e.config->>'plannedPerArm')::int AND c.n_b>=(e.config->>'plannedPerArm')::int THEN 'observing' ELSE 'insufficient_sample' END,
        enrollment_closed_at=${now.toISOString()} FROM counts c WHERE e.id=c.id AND e.state='running' AND
        (${now.toISOString()}::timestamptz>=e.started_at+interval '42 days' OR ${now.toISOString()}::timestamptz>=e.started_at+interval '14 days' AND c.n_a>=(e.config->>'plannedPerArm')::int AND c.n_b>=(e.config->>'plannedPerArm')::int)
        RETURNING e.id,e.org_id,e.state`;
        for (const e of changed)
            await experimentEvent(conn, {
                orgId: e.org_id,
                experimentId: e.id,
                action: "enrollment_closed",
                detail: { state: e.state, cause: "predeclared_count_and_time_rule" },
            });
        await conn`UPDATE email_copy_experiments e SET state='decision_ready' WHERE e.state IN('enrollment_closed','observing') AND (${orgId ?? null}::uuid IS NULL OR e.org_id=${orgId ?? null}::uuid) AND NOT EXISTS(
        SELECT 1 FROM email_copy_assignments a WHERE a.experiment_id=e.id AND a.cohort='primary' AND a.initial_scheduled_at+interval '14 days'>${now.toISOString()}::timestamptz)`;
        return { advanced: changed.length };
    });
}
