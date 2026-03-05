ALTER TABLE "email_send_logs" ADD COLUMN "is_opened" integer DEFAULT 0 NOT NULL;
ALTER TABLE "email_send_logs" ADD COLUMN "opened_at" timestamp with time zone;
