-- 0121 이메일 통계 집계 표 (docs/2026-10-21-email-dashboard-stats/DESIGN.md 4절)
-- 새 집계 표만 만든다. email_send_logs 등 기존 표에는 ALTER·FK·색인을 걸지 않는다. 다시 돌아도 같다(IF NOT EXISTS).
-- FK는 organizations(작은 표)에만 건다(email_health_daily 선례). 발송 id에는 FK가 없다(email_replies·email_bounce_signals 관례).
-- 잠금: 새 표 생성과 organizations의 SHARE ROW EXCLUSIVE(잠깐)뿐이다. 5초 안에 못 얻으면 55P03 → migrate.ts가 다시 시도한다.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_stats_send_attr" (
    "send_log_id" integer PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "stat_date" date NOT NULL,
    "workspace_id" integer NOT NULL DEFAULT 0,
    "partition_id" integer NOT NULL DEFAULT 0,
    "trigger_type" varchar(30) NOT NULL DEFAULT '',
    "campaign_kind" varchar(10) NOT NULL,
    "campaign_id" integer NOT NULL DEFAULT 0,
    "root_log_id" integer NOT NULL,
    "step_index" smallint NOT NULL,
    "sender_profile_id" integer NOT NULL DEFAULT 0,
    "sender_domain" varchar(200) NOT NULL DEFAULT '',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "email_stats_send_attr_kind_chk" CHECK ("campaign_kind" IN ('ai','template','manual'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_stats_send_attr_org_date_idx" ON "email_stats_send_attr" ("org_id", "stat_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_stats_daily" (
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "grain" varchar(10) NOT NULL,
    "stat_date" date NOT NULL,
    "workspace_id" integer NOT NULL DEFAULT 0,
    "campaign_kind" varchar(10) NOT NULL DEFAULT '',
    "campaign_id" integer NOT NULL DEFAULT 0,
    "step_index" smallint NOT NULL DEFAULT -1,
    "partition_id" integer NOT NULL DEFAULT 0,
    "sender_profile_id" integer NOT NULL DEFAULT 0,
    "sender_domain" varchar(200) NOT NULL DEFAULT '',
    "trigger_type" varchar(30) NOT NULL DEFAULT '',
    "total" integer NOT NULL DEFAULT 0,
    "accepted" integer NOT NULL DEFAULT 0,
    "sent" integer NOT NULL DEFAULT 0,
    "failed" integer NOT NULL DEFAULT 0,
    "pending" integer NOT NULL DEFAULT 0,
    "delivered" integer NOT NULL DEFAULT 0,
    "bounced" integer NOT NULL DEFAULT 0,
    "bounced_hard" integer NOT NULL DEFAULT 0,
    "sender_side" integer NOT NULL DEFAULT 0,
    "nhn_unsub" integer NOT NULL DEFAULT 0,
    "send_reject" integer NOT NULL DEFAULT 0,
    "unconfirmed" integer NOT NULL DEFAULT 0,
    "open_base" integer NOT NULL DEFAULT 0,
    "opened" integer NOT NULL DEFAULT 0,
    "clicked" integer NOT NULL DEFAULT 0,
    "opened_clicked" integer NOT NULL DEFAULT 0,
    "replied" integer NOT NULL DEFAULT 0,
    "auto_replied" integer NOT NULL DEFAULT 0,
    "first_accepted" integer NOT NULL DEFAULT 0,
    "first_sent" integer NOT NULL DEFAULT 0,
    "seq_replied" integer NOT NULL DEFAULT 0,
    "unsubscribed" integer NOT NULL DEFAULT 0,
    "complained" integer NOT NULL DEFAULT 0,
    "visited" integer NOT NULL DEFAULT 0,
    "site_actions" integer NOT NULL DEFAULT 0,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "email_stats_daily_pkey" PRIMARY KEY ("org_id", "grain", "stat_date", "workspace_id", "campaign_kind", "campaign_id", "step_index", "partition_id", "sender_profile_id", "sender_domain", "trigger_type"),
    CONSTRAINT "email_stats_daily_grain_chk" CHECK ("grain" IN ('total','campaign','partition','sender','trigger'))
) WITH (fillfactor = 80);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_stats_lead_days" (
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "stat_date" date NOT NULL,
    "workspace_id" integer NOT NULL,
    "customer_key" varchar(64) NOT NULL,
    "tier" varchar(10) NOT NULL,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "email_stats_lead_days_pkey" PRIMARY KEY ("org_id", "stat_date", "workspace_id", "customer_key"),
    CONSTRAINT "email_stats_lead_days_tier_chk" CHECK ("tier" IN ('urgent','highlight'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_stats_state" (
    "org_id" uuid PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
    "first_send_date" date, -- 첫 발송과 첫 record 생성 중 이른 KST 날짜(공통 백필 하한)
    "filled_from" date,
    "backfill_done_at" timestamptz,
    "recent_done_at" timestamptz,
    "nightly_date" date,
    "nightly_next" date,
    "wm_open_id" integer NOT NULL DEFAULT 0,
    "wm_click_id" integer NOT NULL DEFAULT 0,
    "wm_reply_id" integer NOT NULL DEFAULT 0,
    "wm_unsub_id" integer NOT NULL DEFAULT 0,
    "wm_complaint_id" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "last_error_at" timestamptz,
    "manual_refreshed_at" timestamptz,          -- 수동 갱신 쿨다운 (7-8)
    "stats" jsonb,
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "home_stats_daily" (
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "stat_date" date NOT NULL,
    "source" varchar(10) NOT NULL,
    "template_name" varchar(200) NOT NULL DEFAULT '',
    "total" integer NOT NULL DEFAULT 0,
    "sent" integer NOT NULL DEFAULT 0,
    "failed" integer NOT NULL DEFAULT 0,
    "pending" integer NOT NULL DEFAULT 0,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "home_stats_daily_pkey" PRIMARY KEY ("org_id", "stat_date", "source", "template_name"),
    CONSTRAINT "home_stats_daily_source_chk" CHECK ("source" IN ('alimtalk','records'))
);
