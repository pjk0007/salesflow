import { sql } from "drizzle-orm";
import {
    pgTable,
    uuid,
    integer,
    varchar,
    text,
    jsonb,
    timestamp,
    date,
    index,
    check,
} from "drizzle-orm/pg-core";
import { organizations, workspaces, users } from "./schema";
import { crmContacts } from "./customer-platform-schema";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
/** 관계 정비(명함 인맥 꾸준 관리) — 고객 1명당 1행. 연락 이력은 crm_activities(source='relationship')에 남긴다. drizzle/0127 */
export const crmRelationshipCare = pgTable(
    "crm_relationship_care",
    {
        contactId: uuid("contact_id")
            .primaryKey()
            .references(() => crmContacts.id, { onDelete: "cascade" }),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        version: integer("version").notNull().default(1),
        tier: varchar("tier", { length: 1 }).notNull().default("c"),
        cadenceDays: integer("cadence_days"),
        ownerUserId: uuid("owner_user_id").references(() => users.id, {
            onDelete: "set null",
        }),
        metPlace: varchar("met_place", { length: 200 }),
        metOn: date("met_on"),
        memoryNote: text("memory_note").notNull().default(""),
        importantDates: jsonb("important_dates")
            .$type<{ label: string; monthDay: string }[]>()
            .notNull()
            .default([]),
        lastTouchAt: time("last_touch_at"),
        nextDueAt: time("next_due_at").notNull(),
        snoozedUntil: time("snoozed_until"),
        unansweredCount: integer("unanswered_count").notNull().default(0),
        createdAt: time("created_at").notNull().defaultNow(),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        index("crm_relationship_due").on(
            t.orgId,
            t.workspaceId,
            t.nextDueAt,
        ),
        index("crm_relationship_owner_due").on(
            t.orgId,
            t.workspaceId,
            t.ownerUserId,
            t.nextDueAt,
        ),
        check("crm_relationship_tier", sql`${t.tier} IN ('a','b','c','d')`),
        check(
            "crm_relationship_cadence",
            sql`${t.cadenceDays} IS NULL OR ${t.cadenceDays} BETWEEN 1 AND 730`,
        ),
    ],
);
