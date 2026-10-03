-- 깊이 들어온 사람 알림 (docs/2026-10-02-deep-visitor-alert/DESIGN.md 6절)
-- (레코드, 수준)당 한 줄만 둔다 — 5분마다 도는 워커가 같은 사람을 같은 수준으로 다시 보내지 않게 유니크 키로 막는다.
-- message에 카드 글자를 그대로 남겨 dry_run에서 무엇이 나갈지 확인할 수 있게 한다.
-- send_log_id·session_id·visitor_id는 FK를 걸지 않는다 — 원본이 지워져도 알림 기록은 남긴다.
CREATE TABLE IF NOT EXISTS "deep_visitor_alerts" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL,
    "workspace_id" integer NOT NULL,
    "site_id" integer,
    "record_id" integer NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
    "send_log_id" integer,
    "session_id" integer,
    "visitor_id" integer,
    "level" varchar(20) NOT NULL,          -- deep | intent
    "angle" varchar(5) NOT NULL,           -- A~E
    "deepest_stage" integer NOT NULL,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,  -- pending | processing | sent | failed | skipped | dry_run
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "message" text NOT NULL,
    "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
    "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
    "locked_at" timestamp with time zone,
    "sent_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "dva_record_level_idx" ON "deep_visitor_alerts" ("record_id", "level");
CREATE INDEX IF NOT EXISTS "dva_pickup_idx" ON "deep_visitor_alerts" ("status", "scheduled_at", "id");
CREATE INDEX IF NOT EXISTS "dva_org_detected_idx" ON "deep_visitor_alerts" ("org_id", "detected_at");
