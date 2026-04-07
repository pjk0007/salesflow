CREATE TABLE IF NOT EXISTS "email_click_logs" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL,
    "send_log_id" integer NOT NULL REFERENCES "email_send_logs"("id") ON DELETE CASCADE,
    "url" text NOT NULL,
    "clicked_at" timestamptz DEFAULT now() NOT NULL,
    "ip" varchar(50),
    "user_agent" text
);

CREATE INDEX IF NOT EXISTS "email_click_logs_send_log_idx" ON "email_click_logs" ("send_log_id");
