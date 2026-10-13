export type ExperimentState =
    | "draft"
    | "evaluated"
    | "running"
    | "enrollment_closed"
    | "observing"
    | "decision_ready"
    | "closed"
    | "paused"
    | "data_check"
    | "insufficient_sample"
    | "invalidated";
export type ExperimentArm = "A" | "B";
export type ReplyIntent = "interested" | "neutral" | "rejected" | "unknown";
export interface ExperimentConfig {
    subject: string;
    axis: "opening" | "question" | "tone" | "length";
    hypothesis: string;
    policyAId: number;
    policyBId: number;
    knowledgeVersionId: number;
    primaryMetric: "positive_reply_14d_itt";
    allocation: 0.5;
    alpha: 0.05;
    power: 0.8;
    baselineRate: number;
    minimumDetectableEffect: number;
    plannedPerArm: number;
    minimumPracticalDifference: number;
    minEnrollmentDays: 14;
    maxEnrollmentDays: 42;
    observationDays: 14;
    meetingDays: 30;
    replySource: "connected" | "manual";
    manualCollectionOwnerId: string | null;
    guardrails: {
        rejectionRate: number;
        unsubscribeRate: number;
        generationFailureRate: number;
        baselineNote: string;
    };
    ruleSnapshot: Record<string, unknown>;
    ruleFingerprint: string;
}
export interface Experiment {
    id: number;
    org_id: string;
    workspace_id: number;
    rule_id: number;
    name: string;
    state: ExperimentState;
    config: ExperimentConfig;
    started_at: Date | null;
    enrollment_closed_at: Date | null;
    closed_at: Date | null;
    pending_mode: "continue" | "hold";
    paused_from: ExperimentState | null;
    invalidation_reason: string | null;
}
export interface Assignment {
    id: number;
    experiment_id: number;
    org_id: string;
    workspace_id: number;
    normalized_email: string;
    customer_key: string;
    arm: ExperimentArm;
    cohort: "primary" | "exploratory";
    company_key: string | null;
    record_id: number;
    initial_scheduled_at: Date;
    planned_sender_id: number | null;
    actual_sender_id: number | null;
    stratum: string;
    planned_sender_email: string | null;
    actual_sender_email: string | null;
    assigned_at: Date;
    send_log_id: number | null;
    actual_sent_at: Date | null;
    generation_job_id: number | null;
}
export interface ExperimentObservation {
    assignmentId: number;
    arm: ExperimentArm;
    cohort: Assignment["cohort"];
    scheduledAt: Date;
    sentAt: Date | null;
    generated: boolean;
    generationFailed: boolean;
    unsubscribed: boolean;
    contaminated: boolean;
    replies: { eventAt: Date; intent: ReplyIntent }[];
    meetings: Date[];
}
export interface ArmSummary {
    assigned: number;
    matured: number;
    generated: number;
    generationFailures: number;
    sent: number;
    humanReplies: number;
    positive: number;
    unknown: number;
    rejected: number;
    unsubscribed: number;
    contaminated: number;
    humanReplyEvents: number;
    unclassifiedReplies: number;
    actualSendMatured: number;
    actualSendPositive: number;
    meetings30d: number;
    meetingMatured: number;
    positiveRate: number | null;
    classificationCoverage: number | null;
    actualSendPositiveRate: number | null;
}
