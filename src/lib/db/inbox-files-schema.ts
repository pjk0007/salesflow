import { sql } from "drizzle-orm";
import {
    pgTable,
    uuid,
    integer,
    varchar,
    timestamp,
    jsonb,
    uniqueIndex,
    index,
    check,
    customType,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";
import {
    inboxChannels,
    inboxConversations,
    inboxMessages,
} from "./inbox-schema";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "bytea",
    toDriver: (value) => value,
    fromDriver: (value) => Buffer.from(value),
});
export const inboxAttachments = pgTable(
    "inbox_attachments",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        draftConversationId: uuid("draft_conversation_id").references(
            () => inboxConversations.id,
            { onDelete: "cascade" },
        ),
        messageId: integer("message_id").references(() => inboxMessages.id, {
            onDelete: "cascade",
        }),
        ownerKey: varchar("owner_key", { length: 64 }).notNull(),
        clientId: uuid("client_id").notNull(),
        kind: varchar("kind", { length: 16 }).notNull(),
        fileName: varchar("file_name", { length: 180 }).notNull(),
        contentType: varchar("content_type", { length: 120 }).notNull(),
        size: integer("size").notNull(),
        sha256: varchar("sha256", { length: 64 }).notNull(),
        importMetadata: jsonb("import_metadata").$type<{
            taskId: string;
            source: string;
            previousSource: boolean;
        }>(),
        expiresAt: time("expires_at"),
        cancelledAt: time("cancelled_at"),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_attachment_client").on(
            t.channelId,
            t.ownerKey,
            t.clientId,
        ),
        index("inbox_attachment_message").on(t.messageId),
        index("inbox_attachment_expiry")
            .on(t.channelId, t.expiresAt)
            .where(sql`${t.messageId} IS NULL AND ${t.cancelledAt} IS NULL`),
        check(
            "inbox_attachment_kind",
            sql`${t.kind} IN ('customer','reply','note')`,
        ),
        check(
            "inbox_attachment_size",
            sql`${t.size} > 0 AND ${t.size} <= 20971520`,
        ),
    ],
);
export const inboxAttachmentBlobs = pgTable("inbox_attachment_blobs", {
    attachmentId: uuid("attachment_id")
        .primaryKey()
        .references(() => inboxAttachments.id, { onDelete: "cascade" }),
    bytes: bytea("bytes").notNull(),
});
export const inboxAuditEvents = pgTable(
    "inbox_audit_events",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        conversationId: uuid("conversation_id").references(
            () => inboxConversations.id,
            { onDelete: "cascade" },
        ),
        actorId: uuid("actor_id").references(() => users.id, {
            onDelete: "set null",
        }),
        actorName: varchar("actor_name", { length: 100 }).notNull(),
        action: varchar("action", { length: 60 }).notNull(),
        changes: jsonb("changes")
            .$type<
                Record<
                    string,
                    {
                        before: unknown;
                        after: unknown;
                        beforeLabel?: string;
                        afterLabel?: string;
                    }
                >
            >()
            .notNull(),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        index("inbox_audit_conversation").on(
            t.conversationId,
            t.createdAt,
            t.id,
        ),
    ],
);
