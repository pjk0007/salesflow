CREATE TABLE IF NOT EXISTS "email_prepared_sends" (
    "id" serial PRIMARY KEY,
    "queue_id" integer NOT NULL REFERENCES "email_send_queue"("id") ON DELETE CASCADE,
    "link_id" integer NOT NULL REFERENCES "email_auto_personalized_links"("id") ON DELETE CASCADE,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "sender_profile_id" integer NOT NULL REFERENCES "email_sender_profiles"("id") ON DELETE CASCADE,
    "usage_date" varchar(10) NOT NULL,
    "ordinal" integer NOT NULL,
    "scheduled_at" timestamptz NOT NULL,
    "source_hash" varchar(64) NOT NULL,
    "payload" jsonb,
    "status" varchar(20) DEFAULT 'reserved' NOT NULL,
    "log_id" integer REFERENCES "email_send_logs"("id") ON DELETE SET NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eps_queue_link_idx" ON "email_prepared_sends" ("queue_id", "link_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eps_slot_idx" ON "email_prepared_sends" ("sender_profile_id", "usage_date", "ordinal") WHERE "status" <> 'cancelled';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eps_sender_day_idx" ON "email_prepared_sends" ("sender_profile_id", "usage_date", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_sender_daily_plans" (
    "sender_profile_id" integer NOT NULL REFERENCES "email_sender_profiles"("id") ON DELETE CASCADE,
    "usage_date" varchar(10) NOT NULL,
    "start_at" timestamptz NOT NULL,
    PRIMARY KEY ("sender_profile_id", "usage_date")
);
