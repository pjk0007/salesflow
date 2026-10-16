import {
    pgTable,
    uuid,
    integer,
    varchar,
    timestamp,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { organizations, users, workspaces } from "./schema";
import type { WorkspaceRole } from "@/lib/customer-access/rules";
export const customerWorkspaceAccess = pgTable(
    "customer_workspace_access",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 20 }).$type<WorkspaceRole>().notNull(),
        version: integer("version").notNull().default(1),
        updatedBy: uuid("updated_by").references(() => users.id),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (t) => [
        uniqueIndex("customer_access_workspace_user").on(
            t.workspaceId,
            t.userId,
        ),
        index("customer_access_user").on(t.orgId, t.userId),
    ],
);
export const customerAccessAudit = pgTable(
    "customer_access_audit",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        actorId: uuid("actor_id").references(() => users.id),
        actorName: varchar("actor_name", { length: 100 }).notNull(),
        beforeRole: varchar("before_role", { length: 20 })
            .$type<WorkspaceRole>()
            .notNull(),
        afterRole: varchar("after_role", { length: 20 })
            .$type<WorkspaceRole>()
            .notNull(),
        version: integer("version").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (t) => [
        index("customer_access_audit_recent").on(
            t.orgId,
            t.workspaceId,
            t.createdAt,
            t.id,
        ),
    ],
);
