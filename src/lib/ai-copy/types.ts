export type CopyPurpose = "initial_email" | "visit_ack";
export type VersionState =
    | "draft"
    | "evaluating"
    | "evaluated"
    | "approved"
    | "retired"
    | "blocked";
export type JobState = "pending" | "generating" | "ready" | "retry" | "held" | "cancelled";
export interface KnowledgeClaim {
    text: string;
    sourceUrl: string;
    checkedAt: string;
    purposes: CopyPurpose[];
}
export interface KnowledgeSnapshot {
    businessName: string;
    claims: KnowledgeClaim[];
}
export interface PerformanceTargets {
    p95Ms: number;
    p99Ms: number;
    firstAttemptSuccess: number;
    readyWithin30Minutes: number;
    queueP95Ms: number;
    duplicateRate: number;
    questionShare: number;
    costRatio: number;
    overrideReason?: string;
}
export interface PolicySnapshot {
    purpose: CopyPurpose;
    provider: "claude" | "gemini" | "deepseek";
    model: string;
    parameters: { maxOutputTokens: number; temperature: number };
    instructions: string;
    requiredMeanings: string[];
    forbiddenPhrases: string[];
    maxCharacters: number;
    validatorVersion: "copy-v1" | "legacy-initial-v1" | "legacy-ack-v1";
    targets: PerformanceTargets;
}
export interface CopyOutput {
    subject: string;
    htmlBody: string;
    fingerprint: string;
    question: string;
}
export interface GenerationContext {
    system: string;
    user: string;
    fixedSubject?: string;
    allowedUrls?: string[];
    /** 감사 메일 수신자 이름은 기존 인사말 생성에만 사용한다. LLM 입력에 넣지 않는다. */
    greeting?: string;
}
export interface CopyVersion<T> {
    id: number;
    org_id: string;
    workspace_id: number;
    state: VersionState;
    snapshot: T;
    fingerprint: string;
    created_by: string;
    created_at: Date;
    evaluation_run_id: number | null;
    last_changed_by: string | null;
    last_changed_at: Date;
    state_reason: string | null;
    last_changed_by_name?: string | null;
    approval_method?: "manual" | "existing_configuration" | "automatic_evaluation";
}
export interface CopyJob {
    id: number;
    org_id: string;
    workspace_id: number;
    purpose: CopyPurpose;
    idempotency_key: string;
    policy_version_id: number | null;
    knowledge_version_id: number | null;
    assignment_id: number | null;
    send_log_id: number | null;
    policy_snapshot: PolicySnapshot;
    knowledge_snapshot: KnowledgeSnapshot | null;
    context: GenerationContext;
    state: JobState;
    output: CopyOutput | null;
    attempts: number;
    validation_failures: number;
    eligible_at: Date;
    retry_at: Date | null;
    lease_until: Date | null;
    reason: string | null;
    created_at: Date;
    origin: "operational" | "evaluation" | "benchmark" | "replacement";
    superseded_by_id: number | null;
    requested_by: string | null;
    approved_context: GenerationContext | null;
}
export type CopyConnection = Awaited<ReturnType<typeof import("../db").queryClient.reserve>>;
