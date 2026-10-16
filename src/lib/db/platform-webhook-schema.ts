import { sql } from "drizzle-orm";
import {
    pgTable,
    uuid,
    integer,
    bigserial,
    varchar,
    boolean,
    jsonb,
    timestamp,
    uniqueIndex,
    index,
    check,
} from "drizzle-orm/pg-core";
import { organizations, workspaces } from "./schema";
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
export type PlatformEventPayload = {
    sequence?: string;
    id: string;
    type: string;
    apiVersion: string;
    workspaceId: number;
    occurredAt: string;
    data: Record<string, unknown>;
};
export const platformEvents = pgTable(
    "platform_events",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        workflowRunId: uuid("workflow_run_id"),
        sequence: bigserial("sequence", { mode: "bigint" }).notNull().unique(),
        ...scope(),
        eventKey: varchar("event_key", { length: 200 }).notNull(),
        type: varchar("type", { length: 80 }).notNull(),
        payload: jsonb("payload").$type<PlatformEventPayload>().notNull(),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("platform_event_key").on(t.workspaceId, t.eventKey),
        index("platform_event_scope").on(
            t.orgId,
            t.workspaceId,
            t.createdAt,
            t.id,
        ),
    ],
);
export const platformWebhooks = pgTable(
    "platform_webhooks",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        ...scope(),
        name: varchar("name", { length: 100 }).notNull(),
        url: varchar("url", { length: 2000 }).notNull(),
        eventTypes: jsonb("event_types").$type<string[]>().notNull(),
        enabled: boolean("enabled").notNull().default(false),
        version: integer("version").notNull().default(1),
        generation: integer("generation").notNull().default(1),
        secretCipher: varchar("secret_cipher", { length: 400 }).notNull(),
        secretHint: varchar("secret_hint", { length: 12 }).notNull(),
        createdAt: time("created_at").notNull().defaultNow(),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [index("platform_webhook_scope").on(t.orgId, t.workspaceId)],
);
export const platformWebhookDeliveries = pgTable(
    "platform_webhook_deliveries",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        ...scope(),
        endpointId: uuid("endpoint_id")
            .notNull()
            .references(() => platformWebhooks.id, { onDelete: "cascade" }),
        eventId: uuid("event_id")
            .notNull()
            .references(() => platformEvents.id, { onDelete: "cascade" }),
        endpointVersion: integer("endpoint_version").notNull(),
        state: varchar("state", { length: 20 }).notNull().default("pending"),
        attempts: integer("attempts").notNull().default(0),
        cycleAttempts: integer("cycle_attempts").notNull().default(0),
        availableAt: time("available_at").notNull().defaultNow(),
        leaseId: uuid("lease_id"),
        leaseUntil: time("lease_until"),
        lastStatus: integer("last_status"),
        lastError: varchar("last_error", { length: 300 }),
        deliveredAt: time("delivered_at"),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("platform_delivery_event").on(t.endpointId, t.eventId),
        index("platform_delivery_due").on(t.state, t.availableAt, t.leaseUntil),
        index("platform_delivery_scope").on(
            t.orgId,
            t.workspaceId,
            t.endpointId,
            t.createdAt,
            t.id,
        ),
        check(
            "platform_delivery_state",
            sql`${t.state} IN ('pending','processing','retry','succeeded','dead','cancelled')`,
        ),
    ],
);
export const platformWebhookAttempts = pgTable(
    "platform_webhook_attempts",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        deliveryId: uuid("delivery_id")
            .notNull()
            .references(() => platformWebhookDeliveries.id, {
                onDelete: "cascade",
            }),
        attempt: integer("attempt").notNull(),
        leaseId: uuid("lease_id").notNull(),
        state: varchar("state", { length: 20 }).notNull(),
        status: integer("status"),
        url: varchar("url", { length: 2000 }).notNull(),
        error: varchar("error", { length: 300 }),
        startedAt: time("started_at").notNull().defaultNow(),
        finishedAt: time("finished_at"),
    },
    (t) => [
        uniqueIndex("platform_attempt_number").on(t.deliveryId, t.attempt),
        check(
            "platform_attempt_state",
            sql`${t.state} IN ('sending','succeeded','failed','unknown')`,
        ),
    ],
);
export const platformWebhookAudit = pgTable("platform_webhook_audit", {
    id: uuid("id").primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id")
        .notNull()
        .references(() => platformWebhooks.id, { onDelete: "cascade" }),
    actorName: varchar("actor_name", { length: 100 }).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    version: integer("version").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
});
