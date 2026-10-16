import {
    pgTable,
    uuid,
    integer,
    timestamp,
    check,
    index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema";
import { inboxConversations } from "./inbox-schema";
export const inboxReplyLeases = pgTable(
    "inbox_reply_leases",
    {
        conversationId: uuid("conversation_id")
            .primaryKey()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        id: uuid("id").notNull(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        sessionId: uuid("session_id").notNull(),
        guardVersion: integer("guard_version").notNull(),
        baseRevision: integer("base_revision").notNull(),
        expiresAt: timestamp("expires_at", {
            withTimezone: true,
            precision: 3,
        }).notNull(),
    },
    (t) => [
        index("inbox_reply_leases_expiry").on(t.expiresAt),
        check(
            "inbox_reply_lease_revision_valid",
            sql`${t.baseRevision}>=0 AND ${t.guardVersion}>=0`,
        ),
    ],
);
