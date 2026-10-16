import { sql } from "drizzle-orm";
import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    jsonb,
    timestamp,
    date,
    numeric,
    uniqueIndex,
    index,
    check,
} from "drizzle-orm/pg-core";
import { organizations, workspaces, users } from "./schema";
import { crmContacts, crmCompanies } from "./customer-platform-schema";
export interface PipelineStage {
    id: string;
    name: string;
    category: "open" | "won" | "lost";
}
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
const base = () => ({
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 200 }).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
});
const relations = () => ({
    contactId: uuid("contact_id").references(() => crmContacts.id, {
        onDelete: "set null",
    }),
    companyId: uuid("company_id").references(() => crmCompanies.id, {
        onDelete: "set null",
    }),
    ownerId: uuid("owner_id").references(() => users.id, {
        onDelete: "set null",
    }),
});
export const crmPipelines = pgTable(
    "crm_pipelines",
    {
        ...base(),
        name: varchar("name", { length: 100 }).notNull(),
        stages: jsonb("stages").$type<PipelineStage[]>().notNull(),
    },
    (t) => [
        uniqueIndex("crm_pipeline_external").on(t.workspaceId, t.externalId),
    ],
);
export const crmDeals = pgTable(
    "crm_deals",
    {
        ...base(),
        ...relations(),
        title: varchar("title", { length: 200 }).notNull(),
        pipelineId: uuid("pipeline_id")
            .notNull()
            .references(() => crmPipelines.id),
        stageId: uuid("stage_id").notNull(),
        amount: numeric("amount", { precision: 18, scale: 2 })
            .notNull()
            .default("0"),
        currency: varchar("currency", { length: 3 }).notNull().default("KRW"),
        expectedCloseDate: date("expected_close_date"),
        notes: text("notes").notNull().default(""),
        archivedAt: time("archived_at"),
    },
    (t) => [
        uniqueIndex("crm_deal_external").on(t.workspaceId, t.externalId),
        index("crm_deal_pipeline").on(
            t.orgId,
            t.workspaceId,
            t.pipelineId,
            t.stageId,
        ),
        check("crm_deal_amount", sql`${t.amount} >= 0`),
    ],
);
export const crmDealHistory = pgTable(
    "crm_deal_history",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        dealId: uuid("deal_id")
            .notNull()
            .references(() => crmDeals.id, { onDelete: "cascade" }),
        actorId: uuid("actor_id").references(() => users.id, {
            onDelete: "set null",
        }),
        actorName: varchar("actor_name", { length: 100 }).notNull(),
        change: jsonb("change").$type<Record<string, unknown>>().notNull(),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [index("crm_deal_history_order").on(t.dealId, t.createdAt, t.id)],
);
export const crmTasks = pgTable(
    "crm_tasks",
    {
        ...base(),
        ...relations(),
        title: varchar("title", { length: 200 }).notNull(),
        body: text("body").notNull().default(""),
        dueAt: time("due_at"),
        dealId: uuid("deal_id").references(() => crmDeals.id, {
            onDelete: "set null",
        }),
        status: varchar("status", { length: 16 }).notNull().default("open"),
        completedAt: time("completed_at"),
    },
    (t) => [
        uniqueIndex("crm_task_external").on(t.workspaceId, t.externalId),
        index("crm_task_due").on(t.orgId, t.workspaceId, t.status, t.dueAt),
        check(
            "crm_task_status",
            sql`${t.status} IN ('open','done','cancelled')`,
        ),
    ],
);
