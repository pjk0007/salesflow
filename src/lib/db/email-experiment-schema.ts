import {
    pgTable,
    serial,
    uuid,
    integer,
    text,
    varchar,
    jsonb,
    timestamp,
    boolean,
    numeric,
    unique,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { organizations, users, workspaces, emailSendLogs, emailReplies } from "./schema";
import { aiCopyGenerationJobs, aiCopyPolicyVersions } from "./ai-copy-schema";
import type { ExperimentConfig } from "../email-experiments/types";
const at = (name: string) => timestamp(name, { withTimezone: true });
const org = () =>
    uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull();
const workspace = () =>
    integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull();
export const emailCopyExperiments = pgTable(
    "email_copy_experiments",
    {
        id: serial("id").primaryKey(),
        orgId: org(),
        workspaceId: workspace(),
        ruleId: integer("rule_id").notNull(),
        name: text("name").notNull(),
        state: text("state").default("draft").notNull(),
        config: jsonb("config").$type<ExperimentConfig>().notNull(),
        configFingerprint: varchar("config_fingerprint", { length: 64 }).notNull(),
        createdBy: uuid("created_by")
            .references(() => users.id)
            .notNull(),
        createdAt: at("created_at").defaultNow().notNull(),
        startedAt: at("started_at"),
        enrollmentClosedAt: at("enrollment_closed_at"),
        closedAt: at("closed_at"),
        pendingMode: text("pending_mode").default("continue").notNull(),
        pausedFrom: text("paused_from"),
        invalidationReason: text("invalidation_reason"),
        adoptedPolicyId: integer("adopted_policy_id").references(() => aiCopyPolicyVersions.id),
        adoptedBy: uuid("adopted_by").references(() => users.id),
    },
    (t) => [
        uniqueIndex("email_copy_active_rule_idx")
            .on(t.orgId, t.workspaceId, t.ruleId)
            .where(
                sql`${t.state} IN ('running','enrollment_closed','observing','decision_ready','paused','data_check','insufficient_sample')`,
            ),
    ],
);
export const emailCopyExperimentContacts = pgTable(
    "email_copy_experiment_contacts",
    {
        id: serial("id").primaryKey(),
        orgId: org(),
        workspaceId: workspace(),
        normalizedEmail: text("normalized_email").notNull(),
        companyKey: text("company_key"),
        companyVerified: boolean("company_verified").default(false).notNull(),
        verificationNote: text("verification_note").default("").notNull(),
        tier: text("tier").default("unclassified").notNull(),
        verifiedBy: uuid("verified_by").references(() => users.id),
        verifiedAt: at("verified_at"),
    },
    (t) => [unique().on(t.orgId, t.workspaceId, t.normalizedEmail)],
);
export const emailCopyAssignments = pgTable(
    "email_copy_assignments",
    {
        id: serial("id").primaryKey(),
        experimentId: integer("experiment_id")
            .references(() => emailCopyExperiments.id, { onDelete: "cascade" })
            .notNull(),
        orgId: org(),
        workspaceId: workspace(),
        normalizedEmail: text("normalized_email").notNull(),
        customerKey: varchar("customer_key", { length: 64 }).notNull(),
        arm: text("arm").notNull(),
        cohort: text("cohort").notNull(),
        companyKey: text("company_key"),
        recordId: integer("record_id").notNull(),
        initialScheduledAt: at("initial_scheduled_at").notNull(),
        plannedSenderId: integer("planned_sender_id"),
        actualSenderId: integer("actual_sender_id"),
        stratum: varchar("stratum", { length: 64 }).notNull(),
        tier: text("tier").notNull(),
        plannedSenderEmail: text("planned_sender_email"),
        actualSenderEmail: text("actual_sender_email"),
        assignedAt: at("assigned_at").defaultNow().notNull(),
        generationJobId: integer("generation_job_id").references(
            (): AnyPgColumn => aiCopyGenerationJobs.id,
            { onDelete: "set null" },
        ),
        sendLogId: integer("send_log_id").references(() => emailSendLogs.id, {
            onDelete: "set null",
        }),
        actualSentAt: at("actual_sent_at"),
    },
    (t) => [
        unique().on(t.orgId, t.workspaceId, t.experimentId, t.normalizedEmail),
        uniqueIndex("email_copy_company_representative_idx")
            .on(t.experimentId, t.companyKey)
            .where(sql`${t.cohort}='primary'`),
        index("email_copy_customer_experiment_idx").on(
            t.orgId,
            t.workspaceId,
            t.normalizedEmail,
            t.experimentId,
        ),
    ],
);
export const emailCopyOutcomeRevisions = pgTable(
    "email_copy_outcome_revisions",
    {
        id: serial("id").primaryKey(),
        orgId: org(),
        assignmentId: integer("assignment_id")
            .references(() => emailCopyAssignments.id, { onDelete: "cascade" })
            .notNull(),
        sourceKey: text("source_key").notNull(),
        revision: integer("revision").notNull(),
        eventType: text("event_type").notNull(),
        intent: text("intent"),
        sourceMethod: text("source_method").default("manual").notNull(),
        confidence: numeric("confidence"),
        eventAt: at("event_at").notNull(),
        emailReplyId: integer("email_reply_id").references(() => emailReplies.id, {
            onDelete: "set null",
        }),
        evidence: text("evidence").notNull(),
        active: boolean("active").default(true).notNull(),
        recordedBy: uuid("recorded_by")
            .references(() => users.id)
            .notNull(),
        recordedAt: at("recorded_at").defaultNow().notNull(),
    },
    (t) => [
        unique().on(t.assignmentId, t.sourceKey, t.revision),
        index("email_copy_outcome_history_idx").on(t.assignmentId, t.sourceKey, t.recordedAt),
    ],
);
export const emailCopyExperimentEvents = pgTable("email_copy_experiment_events", {
    id: serial("id").primaryKey(),
    orgId: org(),
    experimentId: integer("experiment_id")
        .references(() => emailCopyExperiments.id, { onDelete: "cascade" })
        .notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    detail: jsonb("detail").default({}).notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
});
