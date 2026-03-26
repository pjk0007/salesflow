DO $$ BEGIN
    ALTER TABLE "email_send_logs" ADD COLUMN "is_opened" integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "email_send_logs" ADD COLUMN "opened_at" timestamp with time zone;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
