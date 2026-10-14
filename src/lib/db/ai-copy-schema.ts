import {
    pgTable,
    serial,
    uuid,
    integer,
    text,
    varchar,
    jsonb,
    timestamp,
    numeric,
    boolean,
    unique,
    primaryKey,
    index,
    uniqueIndex,
    date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { organizations, users, workspaces, emailSendLogs, aiUsageLogs } from "./schema";
import { emailCopyAssignments } from "./email-experiment-schema";
import type {
    CopyOutput,
    GenerationContext,
    KnowledgeSnapshot,
    PolicySnapshot,
} from "../ai-copy/types";
// 불변 트리거와 상태 CHECK는 0083에 있다.
const at = (name: string) => timestamp(name, { withTimezone: true });
const orgColumn = () =>
    uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull();
const workspaceColumn = () =>
    integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull();
const userColumn = (name: string) => uuid(name).references(() => users.id);
const versionColumns = () => ({
    id: serial("id").primaryKey(),
    orgId: orgColumn(),
    workspaceId: workspaceColumn(),
    name: text("name").notNull(),
    state: text("state").default("draft").notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    createdBy: userColumn("created_by").notNull(),
    approvedBy: userColumn("approved_by"),
    approvedAt: at("approved_at"),
    approvalMethod: text("approval_method").default("manual").notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
    evaluationRunId: integer("evaluation_run_id"),
    lastChangedBy: uuid("last_changed_by").references(() => users.id, { onDelete: "set null" }),
    lastChangedAt: at("last_changed_at").defaultNow().notNull(),
    stateReason: text("state_reason"),
});
export const aiCopyKnowledgeVersions = pgTable("ai_copy_knowledge_versions", {
    ...versionColumns(),
    snapshot: jsonb("snapshot").$type<KnowledgeSnapshot>().notNull(),
});
export const aiCopyPolicyVersions = pgTable("ai_copy_policy_versions", {
    ...versionColumns(),
    purpose: text("purpose").notNull(),
    snapshot: jsonb("snapshot").$type<PolicySnapshot>().notNull(),
});
export const aiCopyBindings = pgTable(
    "ai_copy_bindings",
    {
        orgId: orgColumn(),
        workspaceId: workspaceColumn(),
        purpose: text("purpose").notNull(),
        ruleId: integer("rule_id").default(0).notNull(),
        policyVersionId: integer("policy_version_id")
            .references(() => aiCopyPolicyVersions.id)
            .notNull(),
        knowledgeVersionId: integer("knowledge_version_id")
            .references(() => aiCopyKnowledgeVersions.id)
            .notNull(),
        changedBy: userColumn("changed_by").notNull(),
        changedAt: at("changed_at").defaultNow().notNull(),
    },
    (t) => [primaryKey({ columns: [t.orgId, t.workspaceId, t.purpose, t.ruleId] })],
);
export const aiCopyPriceVersions = pgTable(
    "ai_copy_price_versions",
    {
        id: serial("id").primaryKey(),
        orgId: orgColumn(),
        provider: text("provider").notNull(),
        model: text("model").notNull(),
        effectiveAt: at("effective_at").notNull(),
        inputPerMillion: numeric("input_per_million").notNull(),
        outputPerMillion: numeric("output_per_million").notNull(),
        currency: text("currency").notNull(),
        fxToKrw: numeric("fx_to_krw"),
        fxDate: date("fx_date"),
        sourceUrl: text("source_url").notNull(),
        createdBy: userColumn("created_by").notNull(),
        createdAt: at("created_at").defaultNow().notNull(),
    },
    (t) => [unique().on(t.orgId, t.provider, t.model, t.effectiveAt)],
);
export const aiCopyBindingEvents = pgTable(
    "ai_copy_binding_events",
    {
        id: serial("id").primaryKey(),
        orgId: orgColumn(),
        workspaceId: workspaceColumn(),
        purpose: text("purpose").notNull(),
        ruleId: integer("rule_id").notNull(),
        previousPolicyId: integer("previous_policy_id"),
        previousKnowledgeId: integer("previous_knowledge_id"),
        policyVersionId: integer("policy_version_id"),
        knowledgeVersionId: integer("knowledge_version_id"),
        changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
        changedAt: at("changed_at").defaultNow().notNull(),
    },
    (t) => [index("ai_copy_binding_events_org_idx").on(t.orgId, t.id)],
);
export const aiCopyGenerationJobs = pgTable(
    "ai_copy_generation_jobs",
    {
        id: serial("id").primaryKey(),
        orgId: orgColumn(),
        workspaceId: workspaceColumn(),
        purpose: text("purpose").notNull(),
        idempotencyKey: text("idempotency_key").notNull(),
        policyVersionId: integer("policy_version_id").references(() => aiCopyPolicyVersions.id),
        knowledgeVersionId: integer("knowledge_version_id").references(
            () => aiCopyKnowledgeVersions.id,
        ),
        assignmentId: integer("assignment_id").references(
            (): AnyPgColumn => emailCopyAssignments.id,
            { onDelete: "set null" },
        ),
        policySnapshot: jsonb("policy_snapshot").$type<PolicySnapshot>().notNull(),
        knowledgeSnapshot: jsonb("knowledge_snapshot").$type<KnowledgeSnapshot | null>(),
        context: jsonb("context").$type<GenerationContext>().notNull(),
        state: text("state").default("pending").notNull(),
        output: jsonb("output").$type<CopyOutput>(),
        attempts: integer("attempts").default(0).notNull(),
        validationFailures: integer("validation_failures").default(0).notNull(),
        origin: text("origin").default("operational").notNull(),
        supersededById: integer("superseded_by_id").references(
            (): AnyPgColumn => aiCopyGenerationJobs.id,
        ),
        requestedBy: userColumn("requested_by"),
        approvedContext: jsonb("approved_context").$type<GenerationContext>(),
        eligibleAt: at("eligible_at").defaultNow().notNull(),
        readyAt: at("ready_at"),
        retryAt: at("retry_at"),
        leaseUntil: at("lease_until"),
        leaseToken: uuid("lease_token"),
        reason: text("reason"),
        sendLogId: integer("send_log_id").references(() => emailSendLogs.id, {
            onDelete: "set null",
        }),
        createdAt: at("created_at").defaultNow().notNull(),
        updatedAt: at("updated_at").defaultNow().notNull(),
    },
    (t) => [
        unique().on(t.orgId, t.idempotencyKey),
        index("ai_copy_jobs_pick_idx").on(t.state, t.retryAt, t.eligibleAt),
        index("ai_copy_jobs_scope_idx").on(t.orgId, t.workspaceId, t.createdAt),
    ],
);
export const aiCopyGenerationAttempts = pgTable(
    "ai_copy_generation_attempts",
    {
        id: serial("id").primaryKey(),
        jobId: integer("job_id")
            .references(() => aiCopyGenerationJobs.id, { onDelete: "cascade" })
            .notNull(),
        orgId: orgColumn(),
        attemptNumber: integer("attempt_number").notNull(),
        leaseToken: uuid("lease_token").notNull(),
        provider: text("provider").notNull(),
        model: text("model").notNull(),
        startedAt: at("started_at").notNull(),
        finishedAt: at("finished_at"),
        durationMs: integer("duration_ms"),
        result: text("result").default("running").notNull(),
        reason: text("reason"),
        rawOutput: text("raw_output"),
        outputFingerprint: varchar("output_fingerprint", { length: 64 }),
        promptTokens: integer("prompt_tokens"),
        completionTokens: integer("completion_tokens"),
        usageKnown: boolean("usage_known").default(false).notNull(),
        priceVersionId: integer("price_version_id").references(() => aiCopyPriceVersions.id),
        cost: numeric("cost"),
        currency: text("currency"),
        costKrw: numeric("cost_krw"),
        lateUsageKnown: boolean("late_usage_known").default(false).notNull(),
        usageLogged: boolean("usage_logged").default(false).notNull(),
        chargedPromptTokens: integer("charged_prompt_tokens").default(0).notNull(),
        chargedCompletionTokens: integer("charged_completion_tokens").default(0).notNull(),
        usageLogId: integer("usage_log_id").references(() => aiUsageLogs.id, {
            onDelete: "set null",
        }),
    },
    (t) => [unique().on(t.jobId, t.attemptNumber)],
);
export const aiCopyEvaluationRuns = pgTable("ai_copy_evaluation_runs", {
    id: serial("id").primaryKey(),
    orgId: orgColumn(),
    purpose: text("purpose").notNull(),
    datasetVersion: text("dataset_version").notNull(),
    pairs: jsonb("pairs").notNull(),
    state: text("state").default("pending").notNull(),
    report: jsonb("report"),
    performanceEvidence: jsonb("performance_evidence"),
    createdBy: userColumn("created_by").notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
    completedAt: at("completed_at"),
});
export const aiCopyEvaluationCases = pgTable(
    "ai_copy_evaluation_cases",
    {
        id: serial("id").primaryKey(),
        runId: integer("run_id")
            .references(() => aiCopyEvaluationRuns.id, { onDelete: "cascade" })
            .notNull(),
        workspaceId: integer("workspace_id")
            .references(() => workspaces.id)
            .notNull(),
        policyVersionId: integer("policy_version_id")
            .references(() => aiCopyPolicyVersions.id)
            .notNull(),
        caseKey: text("case_key").notNull(),
        repetition: integer("repetition").notNull(),
        blindLabel: varchar("blind_label", { length: 64 }).notNull(),
        reviewRequired: boolean("review_required").notNull(),
        jobId: integer("job_id").references(() => aiCopyGenerationJobs.id),
    },
    (t) => [
        unique().on(t.runId, t.workspaceId, t.policyVersionId, t.caseKey, t.repetition),
        unique().on(t.runId, t.blindLabel),
    ],
);
export const aiCopyHumanReviews = pgTable(
    "ai_copy_human_reviews",
    {
        id: serial("id").primaryKey(),
        caseId: integer("case_id")
            .references(() => aiCopyEvaluationCases.id, { onDelete: "cascade" })
            .notNull(),
        reviewerId: userColumn("reviewer_id").notNull(),
        naturalness: integer("naturalness").notNull(),
        factuality: integer("factuality").notNull(),
        purposeFit: integer("purpose_fit").notNull(),
        criticalError: boolean("critical_error").notNull(),
        notes: text("notes").default("").notNull(),
        createdAt: at("created_at").defaultNow().notNull(),
    },
    (t) => [unique().on(t.caseId, t.reviewerId)],
);
export const aiCopyReviewResolutions = pgTable("ai_copy_review_resolutions", {
    caseId: integer("case_id")
        .references(() => aiCopyEvaluationCases.id, { onDelete: "cascade" })
        .primaryKey(),
    resolvedBy: userColumn("resolved_by").notNull(),
    naturalness: integer("naturalness").notNull(),
    factuality: integer("factuality").notNull(),
    purposeFit: integer("purpose_fit").notNull(),
    criticalError: boolean("critical_error").notNull(),
    reason: text("reason").notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
});
export const aiCopyBenchmarkRuns = pgTable(
    "ai_copy_benchmark_runs",
    {
        id: serial("id").primaryKey(),
        orgId: orgColumn(),
        evaluationRunId: integer("evaluation_run_id")
            .references(() => aiCopyEvaluationRuns.id, { onDelete: "cascade" })
            .notNull(),
        state: text("state").default("running").notNull(),
        hardware: jsonb("hardware").notNull(),
        startedAt: at("started_at").notNull(),
        completedAt: at("completed_at"),
        createdBy: userColumn("created_by").notNull(),
    },
    (t) => [
        uniqueIndex("ai_copy_one_benchmark_idx")
            .on(t.evaluationRunId)
            .where(sql`${t.state}='running'`),
    ],
);
export const aiCopyBenchmarkCases = pgTable(
    "ai_copy_benchmark_cases",
    {
        id: serial("id").primaryKey(),
        runId: integer("run_id")
            .references(() => aiCopyBenchmarkRuns.id, { onDelete: "cascade" })
            .notNull(),
        templateJobId: integer("template_job_id")
            .references(() => aiCopyGenerationJobs.id)
            .notNull(),
        repetition: integer("repetition").notNull(),
        ordinal: integer("ordinal").notNull(),
        scheduledAt: at("scheduled_at").notNull(),
        jobId: integer("job_id").references(() => aiCopyGenerationJobs.id),
    },
    (t) => [
        unique().on(t.runId, t.repetition, t.ordinal),
        index("ai_copy_benchmark_due_idx").on(t.runId, t.scheduledAt),
    ],
);
