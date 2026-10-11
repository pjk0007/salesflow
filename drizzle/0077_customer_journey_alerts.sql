CREATE TABLE IF NOT EXISTS "customer_journey_alerts" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "record_id" integer NOT NULL,
    "session_id" integer NOT NULL,
    "last_activity_at" timestamptz NOT NULL,
    "stage" varchar(100) NOT NULL,
    "message" jsonb NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "attempts" integer NOT NULL DEFAULT 0,
    "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
    "last_error" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "sent_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cja_org_session_unique" ON "customer_journey_alerts" ("org_id", "session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cja_status_next_idx" ON "customer_journey_alerts" ("status", "next_attempt_at");
