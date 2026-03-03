ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone;
