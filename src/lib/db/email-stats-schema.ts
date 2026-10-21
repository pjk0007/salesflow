import { sql } from "drizzle-orm";
import { pgTable, uuid, integer, smallint, varchar, text, date, timestamp, jsonb, primaryKey, index, check } from "drizzle-orm/pg-core";
import { organizations } from "./schema";
export const emailStatsSendAttr = pgTable("email_stats_send_attr", {
    sendLogId: integer("send_log_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    statDate: date("stat_date", { mode: "string" }).notNull(),
    workspaceId: integer("workspace_id").notNull().default(0),
    partitionId: integer("partition_id").notNull().default(0),
    triggerType: varchar("trigger_type", { length: 30 }).notNull().default(""),
    campaignKind: varchar("campaign_kind", { length: 10 }).notNull(),
    campaignId: integer("campaign_id").notNull().default(0),
    rootLogId: integer("root_log_id").notNull(),
    stepIndex: smallint("step_index").notNull(),
    senderProfileId: integer("sender_profile_id").notNull().default(0),
    senderDomain: varchar("sender_domain", { length: 200 }).notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    check("email_stats_send_attr_kind_chk", sql`("campaign_kind" IN ('ai','template','manual'))`),
    index("email_stats_send_attr_org_date_idx").on(table.orgId, table.statDate),
]);
export const emailStatsDaily = pgTable(
    "email_stats_daily",
    {
        orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
        grain: varchar("grain", { length: 10 }).notNull(),
        statDate: date("stat_date", { mode: "string" }).notNull(),
        workspaceId: integer("workspace_id").notNull().default(0),
        campaignKind: varchar("campaign_kind", { length: 10 }).notNull().default(""),
        campaignId: integer("campaign_id").notNull().default(0),
        stepIndex: smallint("step_index").notNull().default(-1),
        partitionId: integer("partition_id").notNull().default(0),
        senderProfileId: integer("sender_profile_id").notNull().default(0),
        senderDomain: varchar("sender_domain", { length: 200 }).notNull().default(""),
        triggerType: varchar("trigger_type", { length: 30 }).notNull().default(""),
        total: integer("total").notNull().default(0),
        accepted: integer("accepted").notNull().default(0),
        sent: integer("sent").notNull().default(0),
        failed: integer("failed").notNull().default(0),
        pending: integer("pending").notNull().default(0),
        delivered: integer("delivered").notNull().default(0),
        bounced: integer("bounced").notNull().default(0),
        bouncedHard: integer("bounced_hard").notNull().default(0),
        senderSide: integer("sender_side").notNull().default(0),
        nhnUnsub: integer("nhn_unsub").notNull().default(0),
        sendReject: integer("send_reject").notNull().default(0),
        unconfirmed: integer("unconfirmed").notNull().default(0),
        openBase: integer("open_base").notNull().default(0),
        opened: integer("opened").notNull().default(0),
        clicked: integer("clicked").notNull().default(0),
        openedClicked: integer("opened_clicked").notNull().default(0),
        replied: integer("replied").notNull().default(0),
        autoReplied: integer("auto_replied").notNull().default(0),
        firstAccepted: integer("first_accepted").notNull().default(0),
        firstSent: integer("first_sent").notNull().default(0),
        seqReplied: integer("seq_replied").notNull().default(0),
        unsubscribed: integer("unsubscribed").notNull().default(0),
        complained: integer("complained").notNull().default(0),
        visited: integer("visited").notNull().default(0),
        siteActions: integer("site_actions").notNull().default(0),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({
            name: "email_stats_daily_pkey",
            columns: [
                table.orgId, table.grain, table.statDate, table.workspaceId, table.campaignKind, table.campaignId, table.stepIndex, table.partitionId, table.senderProfileId, table.senderDomain, table.triggerType
            ]
        }),
        check("email_stats_daily_grain_chk", sql`("grain" IN ('total','campaign','partition','sender','trigger'))`),
    ]
);
export const emailStatsLeadDays = pgTable("email_stats_lead_days", {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    statDate: date("stat_date", { mode: "string" }).notNull(),
    workspaceId: integer("workspace_id").notNull(),
    customerKey: varchar("customer_key", { length: 64 }).notNull(),
    tier: varchar("tier", { length: 10 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    primaryKey({
        name: "email_stats_lead_days_pkey",
        columns: [table.orgId, table.statDate, table.workspaceId, table.customerKey]
    }),
    check("email_stats_lead_days_tier_chk", sql`("tier" IN ('urgent','highlight'))`),
]);
export const emailStatsState = pgTable("email_stats_state", {
    orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
    // records도 같은 커서를 쓰므로 첫 발송·첫 레코드 중 이른 날짜다.

    firstSendDate: date("first_send_date", { mode: "string" }),
    filledFrom: date("filled_from", { mode: "string" }),
    backfillDoneAt: timestamp("backfill_done_at", { withTimezone: true }),
    recentDoneAt: timestamp("recent_done_at", { withTimezone: true }),
    nightlyDate: date("nightly_date", { mode: "string" }),
    nightlyNext: date("nightly_next", { mode: "string" }),
    wmOpenId: integer("wm_open_id").notNull().default(0),
    wmClickId: integer("wm_click_id").notNull().default(0),
    wmReplyId: integer("wm_reply_id").notNull().default(0),
    wmUnsubId: integer("wm_unsub_id").notNull().default(0),
    wmComplaintId: integer("wm_complaint_id").notNull().default(0),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    manualRefreshedAt: timestamp("manual_refreshed_at", { withTimezone: true }),
    stats: jsonb("stats"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const homeStatsDaily = pgTable("home_stats_daily", {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    statDate: date("stat_date", { mode: "string" }).notNull(),
    source: varchar("source", { length: 10 }).notNull(),
    templateName: varchar("template_name", { length: 200 }).notNull().default(""),
    total: integer("total").notNull().default(0),
    sent: integer("sent").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    pending: integer("pending").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    primaryKey({
        name: "home_stats_daily_pkey",
        columns: [table.orgId, table.statDate, table.source, table.templateName]
    }),
    check("home_stats_daily_source_chk", sql`("source" IN ('alimtalk','records'))`),
]);
