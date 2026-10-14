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
import { organizations, workspaces } from "./schema";
import { crmContacts, crmCompanies } from "./customer-platform-schema";
export const crmActivities = pgTable(
    "crm_activities",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        contactId: uuid("contact_id").references(() => crmContacts.id, {
            onDelete: "set null",
        }),
        companyId: uuid("company_id").references(() => crmCompanies.id, {
            onDelete: "set null",
        }),
        source: varchar("source", { length: 30 }).notNull(),
        entityId: varchar("entity_id", { length: 100 }).notNull(),
        eventKey: varchar("event_key", { length: 200 }).notNull(),
        action: varchar("action", { length: 100 }).notNull(),
        summary: varchar("summary", { length: 200 }).notNull(),
        actorName: varchar("actor_name", { length: 100 }),
        metadata: jsonb("metadata")
            .$type<Record<string, unknown>>()
            .notNull()
            .default({}),
        occurredAt: timestamp("occurred_at", {
            withTimezone: true,
            precision: 3,
        })
            .notNull()
            .defaultNow(),
        createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
            .notNull()
            .defaultNow(),
    },
    (t) => [
        uniqueIndex("crm_activity_event").on(t.workspaceId, t.eventKey),
        index("crm_activity_contact").on(
            t.orgId,
            t.workspaceId,
            t.contactId,
            t.occurredAt,
            t.id,
        ),
    ],
);
