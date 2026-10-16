import {
    pgTable,
    uuid,
    integer,
    varchar,
    jsonb,
    timestamp,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { organizations, users, workspaces } from "./schema";
import type {
    CustomerChanges,
    CustomerResource,
} from "@/lib/customer-records/rules";
export const crmObjectAudit = pgTable(
    "crm_object_audit",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        resource: varchar("resource", { length: 20 })
            .$type<CustomerResource>()
            .notNull(),
        objectId: uuid("object_id").notNull(),
        version: integer("version").notNull(),
        action: varchar("action", { length: 20 }).notNull(),
        actorId: uuid("actor_id").references(() => users.id, {
            onDelete: "set null",
        }),
        actorName: varchar("actor_name", { length: 100 }).notNull(),
        source: varchar("source", { length: 20 }).notNull(),
        changes: jsonb("changes").$type<CustomerChanges>().notNull(),
        reason: varchar("reason", { length: 500 }).notNull().default(""),
        createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
            .notNull()
            .defaultNow(),
    },
    (t) => [
        uniqueIndex("crm_object_audit_version").on(
            t.workspaceId,
            t.resource,
            t.objectId,
            t.version,
        ),
        index("crm_object_audit_page").on(
            t.orgId,
            t.workspaceId,
            t.resource,
            t.objectId,
            t.createdAt,
            t.id,
        ),
    ],
);
