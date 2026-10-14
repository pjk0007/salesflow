import { queryClient } from "../db";
import { resolveReplyConfig } from "../email-reply-rules";
import { CopyDeferredError } from "../ai-copy/generation";
import { enrollForPreparation } from "./repository";
import { internalAudienceContains, loadInternalAudience } from "./preview";
import { normalizeEmail } from "../deep-visitor-alert-rules";

export async function connectedReplyAvailable(
    orgId: string,
    workspaceId: number,
    now = new Date(),
) {
    const config = resolveReplyConfig(process.env);
    if (
        config.syncMode !== "on" ||
        !config.credentials ||
        config.readBlockedReason ||
        !config.workspaceIds.includes(workspaceId)
    )
        return false;
    const [state] = await queryClient<
        {
            last_success_at: Date | null;
            last_error_at: Date | null;
            backfill_done_at: Date | null;
        }[]
    >`SELECT last_success_at,last_error_at,backfill_done_at FROM email_reply_mailbox_state WHERE mailbox=${config.mailbox}`;
    const [workspace] =
        await queryClient`SELECT id FROM workspaces WHERE id=${workspaceId} AND org_id=${orgId}`;
    return (
        !!workspace &&
        !!state?.last_success_at &&
        !!state.backfill_done_at &&
        now.getTime() - new Date(state.last_success_at).getTime() <= 15 * 60_000 &&
        (!state.last_error_at || new Date(state.last_error_at) <= new Date(state.last_success_at))
    );
}
export async function prepareEmailExperiment(input: {
    orgId: string;
    workspaceId: number;
    ruleId: number;
    recordId: number;
    email: string;
    company?: unknown;
    plannedAt: Date;
    senderId: number | null;
    senderEmail?: string | null;
    now?: Date;
}) {
    const conn = await queryClient.reserve();
    try {
        const [exists] = await conn<
            { present: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM email_copy_experiments WHERE org_id=${input.orgId} AND workspace_id=${input.workspaceId} AND rule_id=${input.ruleId}
            AND state IN('running','paused','enrollment_closed','observing','decision_ready','data_check','insufficient_sample'))
            OR EXISTS(SELECT 1 FROM email_copy_assignments a JOIN email_copy_experiments e ON e.id=a.experiment_id WHERE a.org_id=${input.orgId} AND a.workspace_id=${input.workspaceId} AND e.rule_id=${input.ruleId} AND a.normalized_email=${normalizeEmail(input.email)}) AS present`;
        if (!exists.present) return { kind: "none" } as const;
        const audience = await loadInternalAudience(
            conn,
            input.orgId,
            (process.env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","),
        );
        const result = await enrollForPreparation(conn, {
            ...input,
            now: input.now ?? new Date(),
            internal: internalAudienceContains(audience, input.email, input.company),
        });
        if (result.kind === "excluded" && result.reason === "invalidated")
            throw new CopyDeferredError(
                new Date(Date.now() + 3600_000),
                "실험 규칙 변경 확인 필요",
                true,
            );
        return result;
    } finally {
        conn.release();
    }
}
export async function recordExperimentDelivery(input: {
    orgId: string;
    jobId: number;
    logId: number;
    accepted: boolean;
    sentAt: Date;
}) {
    await queryClient`UPDATE email_copy_assignments a SET send_log_id=${input.logId},actual_sent_at=CASE WHEN ${input.accepted} THEN COALESCE(actual_sent_at,${input.sentAt.toISOString()}) ELSE actual_sent_at END,
        actual_sender_id=l.sender_profile_id,actual_sender_email=l.sender_email FROM ai_copy_generation_jobs j,email_send_logs l WHERE j.id=${input.jobId} AND j.assignment_id=a.id AND a.org_id=${input.orgId} AND j.org_id=a.org_id AND l.id=${input.logId} AND l.org_id=a.org_id`;
}
