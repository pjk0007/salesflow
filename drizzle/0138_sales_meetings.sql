-- 영업관리: 미팅 기록과 액션플랜 (2026-11-12 주희님 승인)
-- 영업 리드 자체는 레코드(partitions.category = 'sales')에 저장한다.
CREATE TABLE IF NOT EXISTS "sales_meetings" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL,
    "record_id" integer NOT NULL REFERENCES "records"("id") ON DELETE cascade,
    "met_at" timestamp with time zone NOT NULL,
    "title" varchar(200),
    "attendees" text,
    "notes" text,
    "transcript" text,
    "summary" text,
    "audio_url" text,
    "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_meetings_record_idx" ON "sales_meetings" ("record_id", "met_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_action_items" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL,
    "record_id" integer NOT NULL REFERENCES "records"("id") ON DELETE cascade,
    "meeting_id" integer REFERENCES "sales_meetings"("id") ON DELETE cascade,
    "content" text NOT NULL,
    "owner_id" uuid REFERENCES "users"("id") ON DELETE set null,
    "due_at" timestamp with time zone,
    "done_at" timestamp with time zone,
    "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_action_items_record_idx" ON "sales_action_items" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_action_items_open_due_idx" ON "sales_action_items" ("org_id", "due_at") WHERE "done_at" IS NULL;
