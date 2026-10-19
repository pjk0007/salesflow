import { pgTable, integer, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inboxMessages } from "./inbox-schema";

const time = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });
export const inboxChatAlertDeliveries = pgTable("inbox_chat_alert_deliveries", {
    messageId: integer("message_id").primaryKey().references(() => inboxMessages.id, { onDelete: "cascade" }),
    routeHash: varchar("route_hash", { length: 64 }).notNull(),
    state: varchar("state", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    sentParts: integer("sent_parts").notNull().default(0),
    availableAt: time("available_at").notNull().defaultNow(),
    leaseId: uuid("lease_id"), leaseUntil: time("lease_until"),
    lastStatus: integer("last_status"), lastError: varchar("last_error", { length: 500 }),
    deliveredAt: time("delivered_at"), createdAt: time("created_at").notNull().defaultNow(),
}, table => [index("inbox_chat_alert_due").on(table.availableAt).where(sql`${table.state} IN ('pending','retry','processing')`)]);
