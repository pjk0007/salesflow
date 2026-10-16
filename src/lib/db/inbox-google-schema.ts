import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    timestamp,
    uniqueIndex,
    index,
    check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users, organizations } from "./schema";
import { inboxMailboxes, inboxEmailReceipts } from "./inbox-email-schema";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
export const inboxGoogleConnections = pgTable(
    "inbox_google_connections",
    {
        mailboxId: uuid("mailbox_id")
            .primaryKey()
            .references(() => inboxMailboxes.id),
        version: integer("version").notNull().default(1),
        status: varchar("status", { length: 16 })
            .notNull()
            .default("disconnected"),
        clientId: varchar("client_id", { length: 500 }),
        refreshCipher: text("refresh_cipher"),
        connectedBy: uuid("connected_by").references(() => users.id),
        connectedAt: time("connected_at"),
        since: time("since"),
        phase: varchar("phase", { length: 16 }).notNull().default("full"),
        historyId: varchar("history_id", { length: 128 }),
        baselineHistoryId: varchar("baseline_history_id", { length: 128 }),
        pageToken: text("page_token"),
        action: varchar("action", { length: 16 }).notNull().default("poll"),
        fileCursor: uuid("file_cursor"),
        leaseToken: uuid("lease_token"),
        leaseUntil: time("lease_until"),
        nextRunAt: time("next_run_at").notNull().defaultNow(),
        lastPollAt: time("last_poll_at"),
        lastProcessedAt: time("last_processed_at"),
        errorCode: varchar("error_code", { length: 50 }),
        failures: integer("failures").notNull().default(0),
    },
    (t) => [
        index("inbox_google_due").on(t.status, t.nextRunAt),
        check(
            "inbox_google_status",
            sql`${t.status} in ('connected','reconnect','disconnected')`,
        ),
        check("inbox_google_phase", sql`${t.phase} in ('full','history')`),
        check(
            "inbox_google_action",
            sql`${t.action} in ('poll','receive','files','send')`,
        ),
    ],
);
export const inboxGoogleOauthStates = pgTable("inbox_google_oauth_states", {
    stateHash: varchar("state_hash", { length: 64 }).primaryKey(),
    mailboxId: uuid("mailbox_id")
        .notNull()
        .references(() => inboxMailboxes.id),
    orgId: uuid("org_id")
        .notNull()
        .references(() => organizations.id),
    actorId: uuid("actor_id")
        .notNull()
        .references(() => users.id),
    mailboxVersion: integer("mailbox_version").notNull(),
    cookieHash: varchar("cookie_hash", { length: 64 }).notNull(),
    verifierCipher: text("verifier_cipher").notNull(),
    since: time("since").notNull(),
    expiresAt: time("expires_at").notNull(),
    usedAt: time("used_at"),
});
export const inboxGoogleSyncJobs = pgTable(
    "inbox_google_sync_jobs",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        mailboxId: uuid("mailbox_id")
            .notNull()
            .references(() => inboxMailboxes.id),
        connectionVersion: integer("connection_version").notNull(),
        providerMessageId: varchar("provider_message_id", {
            length: 200,
        }).notNull(),
        state: varchar("state", { length: 16 }).notNull().default("pending"),
        reasonCode: varchar("reason_code", { length: 50 }),
        receiptId: uuid("receipt_id").references(() => inboxEmailReceipts.id),
        attempts: integer("attempts").notNull().default(0),
        leaseToken: uuid("lease_token"),
        leaseUntil: time("lease_until"),
        eligibleAt: time("eligible_at").notNull().defaultNow(),
        createdAt: time("created_at").notNull().defaultNow(),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("inbox_google_source_once").on(
            t.mailboxId,
            t.providerMessageId,
        ),
        index("inbox_google_job_due").on(t.mailboxId, t.state, t.eligibleAt),
        check(
            "inbox_google_job_state",
            sql`${t.state} in ('pending','processing','done','skipped','failed')`,
        ),
    ],
);
