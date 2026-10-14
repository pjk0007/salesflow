import { sql } from "drizzle-orm";
import {
    pgTable,
    uuid,
    varchar,
    integer,
    boolean,
    jsonb,
    timestamp,
    uniqueIndex,
    index,
    check,
} from "drizzle-orm/pg-core";
import { organizations, workspaces, records } from "./schema";
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
export const crmCompanies = pgTable(
    "crm_companies",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        ...scope(),
        externalId: varchar("external_id", { length: 200 }).notNull(),
        name: varchar("name", { length: 200 }).notNull(),
        domain: varchar("domain", { length: 253 }),
        attributes: jsonb("attributes")
            .$type<Record<string, unknown>>()
            .notNull()
            .default({}),
        createdAt: time("created_at").notNull().defaultNow(),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("crm_company_external").on(t.workspaceId, t.externalId),
        index("crm_company_scope").on(t.orgId, t.workspaceId),
    ],
);
export const crmContacts = pgTable(
    "crm_contacts",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        ...scope(),
        externalId: varchar("external_id", { length: 200 }).notNull(),
        name: varchar("name", { length: 100 }).notNull(),
        email: varchar("email", { length: 254 }),
        phone: varchar("phone", { length: 40 }),
        recordId: integer("record_id").references(() => records.id, {
            onDelete: "set null",
        }),
        lifecycleStage: varchar("lifecycle_stage", { length: 30 })
            .notNull()
            .default("lead"),
        isInternal: boolean("is_internal").notNull().default(false),
        attributes: jsonb("attributes")
            .$type<Record<string, unknown>>()
            .notNull()
            .default({}),
        createdAt: time("created_at").notNull().defaultNow(),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("crm_contact_external").on(t.workspaceId, t.externalId),
        index("crm_contact_scope").on(t.orgId, t.workspaceId),
        index("crm_contact_record").on(t.recordId),
        check(
            "crm_contact_stage",
            sql`${t.lifecycleStage} IN ('lead','prospect','customer','inactive')`,
        ),
    ],
);
export const crmContactCompanies = pgTable(
    "crm_contact_companies",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        contactId: uuid("contact_id")
            .notNull()
            .references(() => crmContacts.id, { onDelete: "cascade" }),
        companyId: uuid("company_id")
            .notNull()
            .references(() => crmCompanies.id, { onDelete: "cascade" }),
    },
    (t) => [
        uniqueIndex("crm_contact_company_pair").on(t.contactId, t.companyId),
    ],
);
export const crmCustomerEvents = pgTable(
    "crm_customer_events",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        ...scope(),
        contactId: uuid("contact_id")
            .notNull()
            .references(() => crmContacts.id, { onDelete: "cascade" }),
        eventId: uuid("event_id").notNull(),
        name: varchar("name", { length: 100 }).notNull(),
        source: varchar("source", { length: 16 }).notNull(),
        properties: jsonb("properties")
            .$type<Record<string, unknown>>()
            .notNull()
            .default({}),
        occurredAt: time("occurred_at").notNull(),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("crm_event_idempotency").on(t.workspaceId, t.eventId),
        index("crm_event_contact").on(t.contactId, t.occurredAt),
        check("crm_event_source", sql`${t.source} IN ('server','web')`),
    ],
);
