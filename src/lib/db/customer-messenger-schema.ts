import {
    pgTable,
    uuid,
    integer,
    varchar,
    boolean,
    timestamp,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { inboxConversations, inboxMessages } from "./inbox-schema";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
export const customerReplyContacts = pgTable(
    "customer_reply_contacts",
    {
        conversationId: uuid("conversation_id")
            .primaryKey()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        name: varchar("name", { length: 100 }).notNull().default(""),
        phone: varchar("phone", { length: 30 }).notNull().default(""),
        email: varchar("email", { length: 254 }).notNull().default(""),
        notifyEmail: boolean("notify_email").notNull().default(false),
        consentAt: time("consent_at"),
        verifiedAt: time("verified_at"),
        verificationHash: varchar("verification_hash", { length: 64 }),
        verificationExpiresAt: time("verification_expires_at"),
        verificationSentAt: time("verification_sent_at"),
        verificationAttempts: integer("verification_attempts")
            .notNull()
            .default(0),
        verificationSends: integer("verification_sends").notNull().default(0),
        readMessageId: integer("read_message_id").notNull().default(0),
        version: integer("version").notNull().default(1),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        index("customer_reply_contact_email").on(t.email, t.verificationSentAt),
    ],
);
export const customerReplyNotifications = pgTable(
    "customer_reply_notifications",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        conversationId: uuid("conversation_id")
            .notNull()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        messageId: integer("message_id")
            .notNull()
            .references(() => inboxMessages.id, { onDelete: "cascade" }),
        contactVersion: integer("contact_version").notNull(),
        state: varchar("state", { length: 20 }).notNull().default("pending"),
        dueAt: time("due_at").notNull(),
        claimedAt: time("claimed_at"),
        providerId: varchar("provider_id", { length: 200 }),
        reason: varchar("reason", { length: 200 }),
        sentAt: time("sent_at"),
        createdAt: time("created_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("customer_reply_notice_once").on(t.messageId),
        index("customer_reply_notice_due").on(t.state, t.dueAt),
    ],
);
