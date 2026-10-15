import {
    pgTable,
    integer,
    uuid,
    varchar,
    timestamp,
    primaryKey,
    index,
    check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema";
import { inboxChannels, inboxConversations } from "./inbox-schema";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
export const inboxAgentAvailability = pgTable(
    "inbox_agent_availability",
    {
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        state: varchar("state", { length: 16 }).notNull().default("away"),
        version: integer("version").notNull().default(1),
        maxOpenConversations: integer("max_open_conversations"),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.channelId, t.userId] }),
        check(
            "inbox_agent_state_valid",
            sql`${t.state} in ('available','away')`,
        ),
        check(
            "inbox_agent_capacity_valid",
            sql`${t.maxOpenConversations} IS NULL OR ${t.maxOpenConversations} BETWEEN 0 AND 1000`,
        ),
    ],
);
export const inboxAgentSessions = pgTable(
    "inbox_agent_sessions",
    {
        channelId: integer("channel_id")
            .notNull()
            .references(() => inboxChannels.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        sessionId: uuid("session_id").notNull(),
        sequence: integer("sequence").notNull(),
        conversationId: uuid("conversation_id").references(
            () => inboxConversations.id,
            { onDelete: "cascade" },
        ),
        activity: varchar("activity", { length: 16 })
            .notNull()
            .default("viewing"),
        typingUntil: time("typing_until"),
        expiresAt: time("expires_at").notNull(),
    },
    (t) => [
        primaryKey({ columns: [t.channelId, t.userId, t.sessionId] }),
        index("inbox_agent_sessions_live").on(t.channelId, t.expiresAt),
        check(
            "inbox_agent_activity_valid",
            sql`${t.activity} in ('viewing','reply','note')`,
        ),
        check("inbox_agent_sequence_valid", sql`${t.sequence}>=0`),
    ],
);
