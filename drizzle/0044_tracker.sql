-- 1) tracker_sites
CREATE TABLE IF NOT EXISTS "tracker_sites" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "name" varchar(200) NOT NULL,
    "api_key" varchar(64) NOT NULL UNIQUE,
    "domains" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "is_active" integer NOT NULL DEFAULT 1,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("workspace_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_sites_api_key_idx" ON "tracker_sites" ("api_key");

-- 2) tracker_visitors
CREATE TABLE IF NOT EXISTS "tracker_visitors" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "site_id" integer NOT NULL REFERENCES "tracker_sites"("id") ON DELETE CASCADE,
    "visitor_id" varchar(64) NOT NULL,
    "record_id" integer,
    "email" varchar(200),
    "name" varchar(100),
    "phone" varchar(20),
    "first_seen_at" timestamptz NOT NULL DEFAULT now(),
    "last_seen_at" timestamptz NOT NULL DEFAULT now(),
    "total_visits" integer NOT NULL DEFAULT 1,
    "total_pageviews" integer NOT NULL DEFAULT 0,
    "total_events" integer NOT NULL DEFAULT 0,
    "device_type" varchar(20),
    "browser" varchar(50),
    "os" varchar(50),
    "first_utm_source" varchar(100),
    "first_utm_medium" varchar(100),
    "first_utm_campaign" varchar(200),
    "last_utm_source" varchar(100),
    "last_utm_medium" varchar(100),
    "last_utm_campaign" varchar(200),
    "first_referrer" text,
    "last_referrer" text,
    "last_page" text,
    "last_event" varchar(100),
    "last_event_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_visitors_site_visitor_idx"
    ON "tracker_visitors" ("site_id", "visitor_id");
CREATE INDEX IF NOT EXISTS "tracker_visitors_record_id_idx"
    ON "tracker_visitors" ("record_id");
CREATE INDEX IF NOT EXISTS "tracker_visitors_email_idx"
    ON "tracker_visitors" ("email");
CREATE INDEX IF NOT EXISTS "tracker_visitors_site_last_seen_idx"
    ON "tracker_visitors" ("site_id", "last_seen_at" DESC);

-- 3) tracker_sessions
CREATE TABLE IF NOT EXISTS "tracker_sessions" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "tracker_sites"("id") ON DELETE CASCADE,
    "visitor_id" integer NOT NULL REFERENCES "tracker_visitors"("id") ON DELETE CASCADE,
    "session_key" varchar(64) NOT NULL,
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "ended_at" timestamptz,
    "duration" integer,
    "landing_page" text,
    "exit_page" text,
    "page_count" integer NOT NULL DEFAULT 0,
    "traffic_source" varchar(20),
    "referrer" text,
    "utm_source" varchar(100),
    "utm_medium" varchar(100),
    "utm_campaign" varchar(200),
    "utm_term" varchar(200),
    "utm_content" varchar(200),
    "click_id" varchar(64),
    "is_first_visit" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "tracker_sessions_session_key_idx"
    ON "tracker_sessions" ("site_id", "session_key");
CREATE INDEX IF NOT EXISTS "tracker_sessions_visitor_idx"
    ON "tracker_sessions" ("visitor_id");
CREATE INDEX IF NOT EXISTS "tracker_sessions_started_idx"
    ON "tracker_sessions" ("site_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "tracker_sessions_click_id_idx"
    ON "tracker_sessions" ("click_id");

-- 4) tracker_events
CREATE TABLE IF NOT EXISTS "tracker_events" (
    "id" serial PRIMARY KEY,
    "site_id" integer NOT NULL REFERENCES "tracker_sites"("id") ON DELETE CASCADE,
    "session_id" integer NOT NULL REFERENCES "tracker_sessions"("id") ON DELETE CASCADE,
    "visitor_id" integer NOT NULL REFERENCES "tracker_visitors"("id") ON DELETE CASCADE,
    "event_type" varchar(30) NOT NULL,
    "event_name" varchar(100),
    "page_url" text,
    "page_title" text,
    "properties" jsonb,
    "revenue" numeric(14, 2),
    "occurred_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tracker_events_visitor_occurred_idx"
    ON "tracker_events" ("visitor_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "tracker_events_site_occurred_idx"
    ON "tracker_events" ("site_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "tracker_events_type_idx"
    ON "tracker_events" ("site_id", "event_type");

-- 5) emailClickLogs에 click_id 컬럼 추가 (트래커 매칭용)
ALTER TABLE "email_click_logs"
    ADD COLUMN IF NOT EXISTS "click_id" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS "email_click_logs_click_id_idx"
    ON "email_click_logs" ("click_id") WHERE "click_id" IS NOT NULL;
