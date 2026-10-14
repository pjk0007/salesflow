import {
    pgTable,
    uuid,
    integer,
    varchar,
    boolean,
    jsonb,
    timestamp,
    uniqueIndex,
    index,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { crmContacts, crmCompanies } from "./customer-platform-schema";
import { organizations, workspaces, users } from "./schema";
import { platformEvents } from "./platform-webhook-schema";
import type { WorkflowDefinition } from "../customer-workflows/rules";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
const id = () => uuid("id").primaryKey().defaultRandom();
const scope = () => ({
    orgId: uuid("org_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
});
export const customerWorkflows = pgTable(
    "customer_workflows",
    {
        id: id(),
        ...scope(),
        name: varchar("name", { length: 100 }).notNull(),
        description: varchar("description", { length: 1000 })
            .notNull()
            .default(""),
        version: integer("version").notNull().default(1),
        generation: integer("generation").notNull().default(1),
        enabled: boolean("enabled").notNull().default(false),
        activeRevisionId: uuid("active_revision_id").references(
            (): AnyPgColumn => customerWorkflowRevisions.id,
        ),
        createdBy: uuid("created_by").references(() => users.id, {
            onDelete: "set null",
        }),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [index("customer_workflow_scope").on(t.orgId, t.workspaceId, t.id)],
);
export const customerWorkflowRevisions = pgTable(
    "customer_workflow_revisions",
    {
        id: id(),
        workflowId: uuid("workflow_id")
            .notNull()
            .references(() => customerWorkflows.id, { onDelete: "cascade" }),
        version: integer("version").notNull(),
        definition: jsonb("definition").$type<WorkflowDefinition>().notNull(),
        name: varchar("name", { length: 100 }).notNull(),
        description: varchar("description", { length: 1000 }).notNull(),
        fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
        publishedBy: uuid("published_by").references(() => users.id, {
            onDelete: "set null",
        }),
        publishedAt: time("published_at"),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("customer_workflow_revision").on(t.workflowId, t.version),
    ],
);
export type WorkflowPreviewReport = {
    matched: boolean;
    steps: {
        id: string;
        label: string;
        kind: string;
        status: "planned" | "skipped" | "invalid";
        detail: string;
    }[];
    errors: string[];
    context: Record<string, unknown>;
    hasCustomerReply: boolean;
};
export const customerWorkflowPreviews = pgTable("customer_workflow_previews", {
    id: id(),
    workflowId: uuid("workflow_id")
        .notNull()
        .references(() => customerWorkflows.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
        .notNull()
        .references(() => customerWorkflowRevisions.id, {
            onDelete: "cascade",
        }),
    eventId: uuid("event_id")
        .notNull()
        .references(() => platformEvents.id, { onDelete: "cascade" }),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    report: jsonb("report").$type<WorkflowPreviewReport>().notNull(),
    passed: boolean("passed").notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
        onDelete: "set null",
    }),
    createdAt: time("created_at").notNull().defaultNow(),
});
export const customerWorkflowRuns = pgTable(
    "customer_workflow_runs",
    {
        id: id(),
        ...scope(),
        workflowId: uuid("workflow_id")
            .notNull()
            .references(() => customerWorkflows.id, { onDelete: "cascade" }),
        revisionId: uuid("revision_id")
            .notNull()
            .references(() => customerWorkflowRevisions.id),
        generation: integer("generation").notNull(),
        eventId: uuid("event_id")
            .notNull()
            .references(() => platformEvents.id),
        subjectContactId: uuid("subject_contact_id").references(
            () => crmContacts.id,
            { onDelete: "set null" },
        ),
        subjectCompanyId: uuid("subject_company_id").references(
            () => crmCompanies.id,
            { onDelete: "set null" },
        ),
        eventSnapshot: jsonb("event_snapshot")
            .$type<Record<string, unknown>>()
            .notNull(),
        cursor: integer("cursor").notNull().default(0),
        state: varchar("state", { length: 20 }).notNull().default("queued"),
        attempts: integer("attempts").notNull().default(0),
        eligibleAt: time("eligible_at").notNull().defaultNow(),
        leaseId: uuid("lease_id"),
        leaseUntil: time("lease_until"),
        reason: varchar("reason", { length: 500 }),
        createdAt: time("created_at").notNull().defaultNow(),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        index("customer_workflow_contact").on(
            t.workspaceId,
            t.subjectContactId,
            t.state,
        ),
        index("customer_workflow_company").on(
            t.workspaceId,
            t.subjectCompanyId,
            t.state,
        ),
        uniqueIndex("customer_workflow_trigger").on(t.workflowId, t.eventId),
        index("customer_workflow_due").on(t.state, t.eligibleAt, t.leaseUntil),
        index("customer_workflow_runs_page").on(
            t.workflowId,
            t.createdAt,
            t.id,
        ),
    ],
);
export const customerWorkflowSteps = pgTable(
    "customer_workflow_steps",
    {
        id: id(),
        runId: uuid("run_id")
            .notNull()
            .references(() => customerWorkflowRuns.id, { onDelete: "cascade" }),
        stepId: uuid("step_id").notNull(),
        position: integer("position").notNull(),
        kind: varchar("kind", { length: 30 }).notNull(),
        state: varchar("state", { length: 20 }).notNull(),
        detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [uniqueIndex("customer_workflow_step_once").on(t.runId, t.position)],
);
export const customerWorkflowAudit = pgTable("customer_workflow_audit", {
    id: id(),
    workflowId: uuid("workflow_id")
        .notNull()
        .references(() => customerWorkflows.id, { onDelete: "cascade" }),
    actorName: varchar("actor_name", { length: 100 }).notNull(),
    action: varchar("action", { length: 30 }).notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
});
