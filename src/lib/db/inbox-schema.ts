import {
    pgTable,
    serial,
    uuid,
    text,
    varchar,
    boolean,
    integer,
    timestamp,
    jsonb,
    index,
    uniqueIndex,
    primaryKey,
    foreignKey,
    check,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, workspaces, users, records } from "./schema";
import { crmContacts } from "./customer-platform-schema";
import { customerAiJobs } from "./customer-ai-schema";
import type { StoredJourneyContext } from "../inbox-journey/context";

const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
export const inboxChannels = pgTable(
    "inbox_channels",
    {
        id: serial("id").primaryKey(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        publicKey: varchar("public_key", { length: 80 }).notNull(),
        name: varchar("name", { length: 100 }).notNull(),
        greeting: text("greeting")
            .notNull()
            .default("반갑습니다. 무엇을 도와드릴까요?"),
        color: varchar("color", { length: 7 }).notNull().default("#635BFF"),
        allowedOrigins: jsonb("allowed_origins")
            .$type<string[]>()
            .notNull()
            .default([]),
        enabled: boolean("enabled").notNull().default(false),
        replyGuardEnabled: boolean("reply_guard_enabled")
            .notNull()
            .default(false),
        replyGuardVersion: integer("reply_guard_version").notNull().default(0),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_channel_public_key").on(t.publicKey),
        uniqueIndex("inbox_channel_workspace").on(t.workspaceId),
    ],
);

export const inboxTeams = pgTable(
    "inbox_teams",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        name: varchar("name", { length: 100 }).notNull(),
        description: varchar("description", { length: 500 })
            .notNull()
            .default(""),
        autoAssign: boolean("auto_assign").notNull().default(false),
        requireAvailable: boolean("require_available").notNull().default(false),
        requireBusinessHours: boolean("require_business_hours")
            .notNull()
            .default(false),
        enabled: boolean("enabled").notNull().default(true),
        version: integer("version").notNull().default(1),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_team_name").on(t.channelId, sql`lower(${t.name})`),
        uniqueIndex("inbox_team_channel_key").on(t.id, t.channelId),
    ],
);
export const inboxTeamMembers = pgTable(
    "inbox_team_members",
    {
        teamId: uuid("team_id")
            .notNull()
            .references(() => inboxTeams.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        lastAssignedAt: time("last_assigned_at"),
    },
    (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);
export const inboxConversations = pgTable(
    "inbox_conversations",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        tokenHash: varchar("token_hash", { length: 64 }).notNull(),
        contactId: uuid("contact_id").references(() => crmContacts.id, {
            onDelete: "set null",
        }),
        mergedIntoId: uuid("merged_into_id").references(
            (): AnyPgColumn => inboxConversations.id,
        ),
        identifiedAt: time("identified_at"),
        historyOnly: boolean("history_only").notNull().default(false),
        isCurrent: boolean("is_current").notNull().default(true),
        customerCreateKey: uuid("customer_create_key"),
        medium: varchar("medium", { length: 16 }).notNull().default("web"),
        importMetadata:
            jsonb("import_metadata").$type<Record<string, unknown>>(),
        name: varchar("name", { length: 100 }).notNull(),
        email: varchar("email", { length: 254 }),
        pageUrl: text("page_url"),
        journeyContext: jsonb("journey_context").$type<StoredJourneyContext>(),
        status: varchar("status", { length: 16 }).notNull().default("open"),
        assigneeId: uuid("assignee_id").references(() => users.id, {
            onDelete: "set null",
        }),
        teamId: uuid("team_id"),
        routingAttemptAt: time("routing_attempt_at"),
        recordId: integer("record_id").references(() => records.id, {
            onDelete: "set null",
        }),
        tags: jsonb("tags").$type<string[]>().notNull().default([]),
        priority: boolean("priority").notNull().default(false),
        preview: text("preview").notNull().default(""),
        lastMessageAt: time("last_message_at").notNull().defaultNow(),
        customerSeq: integer("customer_seq").notNull().default(0),
        replyRevision: integer("reply_revision").notNull().default(0),
        version: integer("version").notNull().default(1),
        aiState: varchar("ai_state", { length: 16 }).notNull().default("auto"),
        aiHandoffReason: varchar("ai_handoff_reason", { length: 300 }),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        foreignKey({
            name: "inbox_conversation_team_channel",
            columns: [t.teamId, t.channelId],
            foreignColumns: [inboxTeams.id, inboxTeams.channelId],
        }),
        index("inbox_team_queue")
            .on(t.channelId, t.teamId, t.lastMessageAt, t.id)
            .where(sql`${t.mergedIntoId} is null`),
        index("inbox_agent_open_workload")
            .on(t.channelId, t.assigneeId)
            .where(
                sql`${t.status}='open' AND ${t.historyOnly}=false AND ${t.mergedIntoId} IS NULL`,
            ),
        index("inbox_routing_pending")
            .on(t.channelId, t.routingAttemptAt, t.createdAt, t.id)
            .where(
                sql`${t.status}='open' AND ${t.assigneeId} IS NULL AND ${t.teamId} IS NOT NULL AND ${t.historyOnly}=false AND ${t.mergedIntoId} IS NULL`,
            ),
        uniqueIndex("inbox_session_unique").on(t.channelId, t.tokenHash),
        uniqueIndex("inbox_contact_unique")
            .on(t.channelId, t.contactId)
            .where(
                sql`${t.historyOnly}=false AND ${t.medium}='web' AND ${t.isCurrent}=true AND ${t.mergedIntoId} IS NULL`,
            ),
        uniqueIndex("inbox_customer_create_once").on(
            t.channelId,
            t.contactId,
            t.customerCreateKey,
        ),
        index("inbox_customer_history").on(
            t.channelId,
            t.contactId,
            t.lastMessageAt,
            t.id,
        ),
        check("inbox_medium_valid", sql`${t.medium} in ('web','email')`),
        index("inbox_org_recent").on(t.orgId, t.lastMessageAt),
        index("inbox_record").on(t.recordId),
        check(
            "inbox_status_valid",
            sql`${t.status} in ('open','snoozed','closed')`,
        ),
    ],
);

export const inboxMessages = pgTable(
    "inbox_messages",
    {
        id: serial("id").primaryKey(),
        conversationId: uuid("conversation_id")
            .notNull()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        clientId: uuid("client_id").notNull(),
        kind: varchar("kind", { length: 16 }).notNull(),
        body: text("body").notNull(),
        authorId: uuid("author_id").references(() => users.id, {
            onDelete: "set null",
        }),
        authorName: varchar("author_name", { length: 100 }).notNull(),
        aiDraftId: uuid("ai_draft_id").references(
            (): AnyPgColumn => customerAiJobs.id,
            { onDelete: "set null" },
        ),
        originConversationId: uuid("origin_conversation_id").references(
            () => inboxConversations.id,
        ),
        importMetadata:
            jsonb("import_metadata").$type<Record<string, unknown>>(),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_message_idempotency").on(
            t.conversationId,
            t.clientId,
        ),
        index("inbox_messages_order").on(t.conversationId, t.id),
        uniqueIndex("inbox_ai_draft_once")
            .on(t.aiDraftId)
            .where(sql`${t.aiDraftId} IS NOT NULL`),
        check(
            "inbox_message_kind",
            sql`${t.kind} in ('customer','reply','note')`,
        ),
    ],
);

export const inboxReads = pgTable(
    "inbox_reads",
    {
        id: serial("id").primaryKey(),
        conversationId: uuid("conversation_id")
            .notNull()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        customerSeq: integer("customer_seq").notNull().default(0),
    },
    (t) => [uniqueIndex("inbox_read_user").on(t.conversationId, t.userId)],
);
