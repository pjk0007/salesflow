import {
    pgTable,
    serial,
    uuid,
    integer,
    text,
    boolean,
    jsonb,
    timestamp,
    unique,
    uniqueIndex,
    primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users, workspaces } from "./schema";
import {
    aiCopyPolicyVersions,
    aiCopyKnowledgeVersions,
    aiCopyGenerationJobs,
} from "./ai-copy-schema";
import { emailCopyExperiments } from "./email-experiment-schema";
const at = (name: string) => timestamp(name, { withTimezone: true });
const org = () =>
    uuid("org_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" });
export const aiCopyAutomationSettings = pgTable(
    "ai_copy_automation_settings",
    {
        id: serial("id").primaryKey(),
        orgId: org(),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        purpose: text("purpose").notNull(),
        ruleId: integer("rule_id").notNull().default(0),
        enabled: boolean("enabled").notNull().default(false),
        experimentMode: text("experiment_mode").notNull().default("auto"),
        actorId: uuid("actor_id")
            .notNull()
            .references(() => users.id),
        nextRunAt: at("next_run_at").notNull().defaultNow(),
        lastError: text("last_error"),
        updatedAt: at("updated_at").notNull().defaultNow(),
    },
    (t) => [unique().on(t.orgId, t.workspaceId, t.purpose, t.ruleId)],
);
export const aiCopyAutomationCycles = pgTable(
    "ai_copy_automation_cycles",
    {
        id: serial("id").primaryKey(),
        settingId: integer("setting_id")
            .notNull()
            .references(() => aiCopyAutomationSettings.id, { onDelete: "cascade" }),
        orgId: org(),
        workspaceId: integer("workspace_id").notNull(),
        purpose: text("purpose").notNull(),
        ruleId: integer("rule_id").notNull(),
        actorId: uuid("actor_id")
            .notNull()
            .references(() => users.id),
        stage: text("stage").notNull().default("candidate"),
        baselinePolicyId: integer("baseline_policy_id")
            .notNull()
            .references(() => aiCopyPolicyVersions.id),
        candidatePolicyId: integer("candidate_policy_id").references(() => aiCopyPolicyVersions.id),
        knowledgeVersionId: integer("knowledge_version_id")
            .notNull()
            .references(() => aiCopyKnowledgeVersions.id),
        originalBinding: jsonb("original_binding"),
        ruleFingerprint: text("rule_fingerprint"),
        cursor: integer("cursor").notNull().default(0),
        companyCursor: integer("company_cursor").notNull().default(0),
        report: jsonb("report"),
        reason: text("reason"),
        experimentId: integer("experiment_id").references(() => emailCopyExperiments.id),
        experimentOwned: boolean("experiment_owned").notNull().default(false),
        createdAt: at("created_at").notNull().defaultNow(),
        updatedAt: at("updated_at").notNull().defaultNow(),
        appliedBy: uuid("applied_by").references(() => users.id),
        appliedAt: at("applied_at"),
    },
    (t) => [
        uniqueIndex("ai_copy_automation_active_cycle_idx")
            .on(t.settingId)
            .where(sql`stage NOT IN ('applied','declined','blocked')`),
    ],
);
export const aiCopyAutomationSamples = pgTable(
    "ai_copy_automation_samples",
    {
        cycleId: integer("cycle_id")
            .notNull()
            .references(() => aiCopyAutomationCycles.id, { onDelete: "cascade" }),
        sampleIndex: integer("sample_index").notNull(),
        arm: text("arm").notNull(),
        scenario: integer("scenario").notNull(),
        repetition: integer("repetition").notNull(),
        jobId: integer("job_id")
            .notNull()
            .references(() => aiCopyGenerationJobs.id),
    },
    (t) => [primaryKey({ columns: [t.cycleId, t.sampleIndex] })],
);
export const aiCopyAutomationCalls = pgTable("ai_copy_automation_calls", {
    jobId: integer("job_id")
        .primaryKey()
        .references(() => aiCopyGenerationJobs.id, { onDelete: "cascade" }),
    cycleId: integer("cycle_id")
        .notNull()
        .references(() => aiCopyAutomationCycles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    result: jsonb("result"),
    createdAt: at("created_at").notNull().defaultNow(),
});
