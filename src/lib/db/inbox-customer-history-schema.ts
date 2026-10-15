import {
    pgTable,
    uuid,
    integer,
    primaryKey,
    timestamp,
    check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inboxConversations } from "./inbox-schema";
import { crmContacts } from "./customer-platform-schema";
export const inboxCustomerReads = pgTable(
    "inbox_customer_reads",
    {
        conversationId: uuid("conversation_id")
            .notNull()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        contactId: uuid("contact_id")
            .notNull()
            .references(() => crmContacts.id, { onDelete: "cascade" }),
        lastMessageId: integer("last_message_id").notNull().default(0),
        // Replies moved from an anonymous thread can precede the normal ID cursor.
        mergedUnreadIds: integer("merged_unread_ids")
            .array()
            .notNull()
            .default(sql`'{}'::integer[]`),
        readRevision: integer("read_revision").notNull().default(0),
        updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
            .notNull()
            .defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.conversationId, t.contactId] }),
        check(
            "inbox_customer_reads_last_message_id_check",
            sql`${t.lastMessageId}>=0`,
        ),
        check(
            "inbox_customer_reads_read_revision_check",
            sql`${t.readRevision}>=0`,
        ),
    ],
);
