import {
    pgTable,
    uuid,
    integer,
    varchar,
    jsonb,
    timestamp,
    bigint,
    index,
    uniqueIndex,
    boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./schema";
import {
    inboxChannels,
    inboxConversations,
    inboxMessages,
} from "./inbox-schema";
import type { OperationsPolicy } from "@/lib/inbox-operations/rules";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
export const inboxOperationsSettings = pgTable("inbox_operations_settings", {
    channelId: integer("channel_id")
        .primaryKey()
        .references(() => inboxChannels.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
        .notNull()
        .references(() => organizations.id),
    version: integer("version").notNull().default(1),
    policy: jsonb("policy").$type<OperationsPolicy>().notNull(),
    effectiveAt: time("effective_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: time("updated_at").notNull().defaultNow(),
});
export const inboxNotifications = pgTable(
    "inbox_notifications",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id),
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        conversationId: uuid("conversation_id")
            .notNull()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        eventKey: varchar("event_key", { length: 250 }).notNull(),
        type: varchar("type", { length: 30 }).notNull(),
        preview: varchar("preview", { length: 250 }).notNull(),
        customerSeq: integer("customer_seq"),
        messageId: integer("message_id").references(() => inboxMessages.id, {
            onDelete: "set null",
        }),
        readAt: time("read_at"),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_notification_once").on(t.userId, t.eventKey),
        index("inbox_notification_user_recent").on(
            t.orgId,
            t.userId,
            t.createdAt,
            t.id,
        ),
    ],
);
export const inboxServiceCases = pgTable(
    "inbox_service_cases",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id),
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id),
        conversationId: uuid("conversation_id")
            .notNull()
            .references(() => inboxConversations.id),
        originConversationId: uuid("origin_conversation_id")
            .notNull()
            .references(() => inboxConversations.id),
        openedMessageId: integer("opened_message_id")
            .notNull()
            .references(() => inboxMessages.id),
        startedAt: time("started_at").notNull(),
        recordedAt: time("recorded_at").notNull().defaultNow(),
        policy: jsonb("policy").$type<OperationsPolicy>().notNull(),
        policyVersion: integer("policy_version").notNull(),
        policyEffectiveAt: time("policy_effective_at"),
        slaApplied: boolean("sla_applied").notNull(),
        firstReplyAt: time("first_reply_at"),
        firstReplyMs: bigint("first_reply_ms", { mode: "number" }),
        firstResponder: varchar("first_responder", { length: 10 }),
        lastReplyAt: time("last_reply_at"),
        closedAt: time("closed_at"),
        resolutionMs: bigint("resolution_ms", { mode: "number" }),
        resolutionDueAt: time("resolution_due_at"),
        resolutionBreachedAt: time("resolution_breached_at"),
        pausedAt: time("paused_at"),
        pausedMs: bigint("paused_ms", { mode: "number" }).notNull().default(0),
        assigneeAtClose: uuid("assignee_at_close").references(() => users.id),
    },
    (t) => [
        uniqueIndex("inbox_case_opened_once").on(t.openedMessageId),
        index("inbox_case_channel_started").on(t.channelId, t.startedAt, t.id),
        index("inbox_case_conversation").on(t.conversationId),
        index("inbox_case_resolution_due")
            .on(t.resolutionDueAt)
            .where(
                sql`${t.closedAt} is null AND ${t.resolutionBreachedAt} is null`,
            ),
    ],
);
export const inboxResponseObligations = pgTable(
    "inbox_response_obligations",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        caseId: uuid("case_id")
            .notNull()
            .references(() => inboxServiceCases.id, { onDelete: "cascade" }),
        requestedMessageId: integer("requested_message_id")
            .notNull()
            .references(() => inboxMessages.id),
        kind: varchar("kind", { length: 10 }).notNull(),
        startedAt: time("started_at").notNull(),
        dueAt: time("due_at"),
        respondedAt: time("responded_at"),
        replyMessageId: integer("reply_message_id").references(
            () => inboxMessages.id,
        ),
        elapsedMs: bigint("elapsed_ms", { mode: "number" }),
        responder: varchar("responder", { length: 10 }),
        pausedMs: bigint("paused_ms", { mode: "number" }).notNull().default(0),
        breachedAt: time("breached_at"),
    },
    (t) => [
        uniqueIndex("inbox_response_requested_once").on(t.requestedMessageId),
        index("inbox_response_case").on(t.caseId),
        index("inbox_response_due")
            .on(t.dueAt)
            .where(sql`${t.respondedAt} is null AND ${t.breachedAt} is null`),
    ],
);
