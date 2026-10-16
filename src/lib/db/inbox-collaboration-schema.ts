import {
    pgTable,
    uuid,
    integer,
    varchar,
    timestamp,
    primaryKey,
    index,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";
import {
    inboxChannels,
    inboxConversations,
    inboxMessages,
} from "./inbox-schema";
export const inboxMessageMentions = pgTable(
    "inbox_message_mentions",
    {
        messageId: integer("message_id")
            .notNull()
            .references(() => inboxMessages.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id),
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        conversationId: uuid("conversation_id")
            .notNull()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        name: varchar("name", { length: 100 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
            .notNull()
            .defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.messageId, t.userId] }),
        index("inbox_message_mention_user_conversation").on(
            t.orgId,
            t.userId,
            t.conversationId,
        ),
    ],
);
