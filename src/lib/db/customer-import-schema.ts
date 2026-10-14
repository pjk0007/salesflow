import {
    pgTable,
    uuid,
    integer,
    varchar,
    text,
    jsonb,
    timestamp,
    uniqueIndex,
    index,
    boolean,
} from "drizzle-orm/pg-core";
import { organizations, workspaces, users } from "./schema";
import type { ImportInput, ImportPlanRow } from "../customer-imports/rules";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
const scope = () => ({
    orgId: uuid("org_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
});
export const customerImports = pgTable(
    "customer_imports",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        ...scope(),
        source: varchar("source", { length: 20 }).notNull(),
        namespace: varchar("namespace", { length: 80 }).notNull(),
        state: varchar("state", { length: 20 }).notNull().default("ready"),
        version: integer("version").notNull().default(1),
        cursor: integer("cursor").notNull().default(0),
        input: jsonb("input").$type<ImportInput>().notNull(),
        plan: jsonb("plan").$type<ImportPlanRow[]>().notNull(),
        errors: jsonb("errors").$type<string[]>().notNull().default([]),
        warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
        fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
        reason: text("reason"),
        createdBy: uuid("created_by").references(() => users.id, {
            onDelete: "set null",
        }),
        createdAt: time("created_at").notNull().defaultNow(),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        index("customer_import_page").on(
            t.orgId,
            t.workspaceId,
            t.createdAt,
            t.id,
        ),
    ],
);
export const customerImportObjects = pgTable(
    "customer_import_objects",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        ...scope(),
        source: varchar("source", { length: 20 }).notNull(),
        namespace: varchar("namespace", { length: 80 }).notNull(),
        kind: varchar("kind", { length: 20 }).notNull(),
        sourceId: varchar("source_id", { length: 200 }).notNull(),
        targetId: varchar("target_id", { length: 200 }).notNull(),
        sourceFingerprint: varchar("source_fingerprint", {
            length: 64,
        }).notNull(),
        targetFingerprint: varchar("target_fingerprint", {
            length: 64,
        }).notNull(),
        owned: boolean("owned").notNull(),
        jobId: uuid("job_id")
            .notNull()
            .references(() => customerImports.id),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("customer_import_source").on(
            t.workspaceId,
            t.source,
            t.namespace,
            t.kind,
            t.sourceId,
        ),
    ],
);
export const customerImportResults = pgTable(
    "customer_import_results",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        jobId: uuid("job_id")
            .notNull()
            .references(() => customerImports.id, { onDelete: "cascade" }),
        position: integer("position").notNull(),
        operation: varchar("operation", { length: 20 }).notNull(),
        targetId: varchar("target_id", { length: 200 }).notNull(),
        targetFingerprint: varchar("target_fingerprint", {
            length: 64,
        }).notNull(),
        before: jsonb("before"),
        after: jsonb("after"),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [uniqueIndex("customer_import_result_once").on(t.jobId, t.position)],
);
export const customerImportAudit = pgTable("customer_import_audit", {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
        .notNull()
        .references(() => customerImports.id, { onDelete: "cascade" }),
    actorName: varchar("actor_name", { length: 100 }).notNull(),
    action: varchar("action", { length: 30 }).notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
});
