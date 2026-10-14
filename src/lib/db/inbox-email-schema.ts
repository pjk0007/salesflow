import {
    pgTable,
    uuid,
    integer,
    varchar,
    boolean,
    timestamp,
    jsonb,
    uniqueIndex,
    index,
    check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, workspaces } from "./schema";
import { inboxAttachments } from "./inbox-files-schema";
import {
    inboxChannels,
    inboxConversations,
    inboxMessages,
} from "./inbox-schema";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
export const inboxEmailFiles = pgTable(
    "inbox_email_files",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        receiptId: uuid("receipt_id")
            .notNull()
            .references(() => inboxEmailReceipts.id, { onDelete: "cascade" }),
        fileIndex: integer("file_index").notNull(),
        attachmentId: uuid("attachment_id").references(
            () => inboxAttachments.id,
        ),
        state: varchar("state", { length: 16 }).notNull().default("pending"),
        errorCode: varchar("error_code", { length: 40 }),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_email_file_once").on(t.receiptId, t.fileIndex),
        check(
            "inbox_email_file_state",
            sql`${t.state} in ('pending','available','failed','blocked')`,
        ),
        check("inbox_email_file_index", sql`${t.fileIndex}>=0`),
    ],
);
export const inboxMailboxes = pgTable(
    "inbox_mailboxes",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        address: varchar("address", { length: 254 }).notNull(),
        name: varchar("name", { length: 100 }).notNull(),
        enabled: boolean("enabled").notNull().default(false),
        version: integer("version").notNull().default(1),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [uniqueIndex("inbox_mailbox_address").on(t.orgId, t.address)],
);
export const inboxEmailThreads = pgTable(
    "inbox_email_threads",
    {
        conversationId: uuid("conversation_id")
            .primaryKey()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        mailboxId: uuid("mailbox_id")
            .notNull()
            .references(() => inboxMailboxes.id),
        providerThreadId: varchar("provider_thread_id", {
            length: 200,
        }).notNull(),
        correspondent: varchar("correspondent", { length: 254 }).notNull(),
        subject: varchar("subject", { length: 500 }).notNull(),
        lastRfcMessageId: varchar("last_rfc_message_id", {
            length: 998,
        }).notNull(),
        lastReceivedAt: time("last_received_at").notNull(),
        lastInboundMessageId: integer("last_inbound_message_id").references(
            () => inboxMessages.id,
            { onDelete: "set null" },
        ),
    },
    (t) => [
        uniqueIndex("inbox_email_thread_once").on(
            t.mailboxId,
            t.providerThreadId,
        ),
    ],
);
export const inboxEmailReceipts = pgTable(
    "inbox_email_receipts",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        mailboxId: uuid("mailbox_id")
            .notNull()
            .references(() => inboxMailboxes.id),
        providerMessageId: varchar("provider_message_id", {
            length: 200,
        }).notNull(),
        fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
        messageId: integer("message_id").references(() => inboxMessages.id),
        ignoredReason: varchar("ignored_reason", { length: 100 }),
        envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_email_receipt_once").on(
            t.mailboxId,
            t.providerMessageId,
        ),
        index("inbox_email_receipt_message").on(t.messageId),
    ],
);
export const inboxEmailDeliveries = pgTable(
    "inbox_email_deliveries",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        mailboxId: uuid("mailbox_id")
            .notNull()
            .references(() => inboxMailboxes.id),
        messageId: integer("message_id")
            .notNull()
            .references(() => inboxMessages.id),
        mailboxVersion: integer("mailbox_version").notNull(),
        recipient: varchar("recipient", { length: 254 }).notNull(),
        recipientTo: jsonb("recipient_to").$type<string[]>(),
        recipientCc: jsonb("recipient_cc")
            .$type<string[]>()
            .notNull()
            .default([]),
        replyMode: varchar("reply_mode", { length: 12 })
            .notNull()
            .default("reply"),
        sourceMessageId: integer("source_message_id").references(
            () => inboxMessages.id,
            { onDelete: "set null" },
        ),
        requestFingerprint: varchar("request_fingerprint", { length: 64 }),
        subject: varchar("subject", { length: 500 }).notNull(),
        providerThreadId: varchar("provider_thread_id", {
            length: 200,
        }).notNull(),
        rfcMessageId: varchar("rfc_message_id", { length: 998 }).notNull(),
        inReplyTo: varchar("in_reply_to", { length: 998 }).notNull(),
        state: varchar("state", { length: 16 }).notNull().default("queued"),
        leaseToken: uuid("lease_token"),
        leaseUntil: time("lease_until"),
        attempts: integer("attempts").notNull().default(0),
        errorCode: varchar("error_code", { length: 100 }),
        providerMessageId: varchar("provider_message_id", { length: 200 }),
        sentAt: time("sent_at"),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_email_delivery_once").on(t.messageId),
        index("inbox_email_delivery_pending").on(
            t.mailboxId,
            t.state,
            t.createdAt,
        ),
        check(
            "inbox_email_delivery_state",
            sql`${t.state} in ('queued','leased','sending','sent','failed','uncertain','cancelled')`,
        ),
        check(
            "inbox_email_recipients_shape",
            sql`(${t.recipientTo} IS NULL AND ${t.requestFingerprint} IS NULL AND ${t.replyMode}='reply' AND jsonb_array_length(${t.recipientCc})=0) OR (${t.recipientTo} IS NOT NULL AND jsonb_typeof(${t.recipientTo})='array' AND jsonb_typeof(${t.recipientCc})='array' AND jsonb_array_length(${t.recipientTo})>=1 AND jsonb_array_length(${t.recipientTo})+jsonb_array_length(${t.recipientCc})<=30)`,
        ),
        check(
            "inbox_email_reply_mode",
            sql`${t.replyMode} IN ('reply','reply_all','custom')`,
        ),
    ],
);
