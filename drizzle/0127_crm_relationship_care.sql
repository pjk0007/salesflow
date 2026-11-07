-- 관계 정비(명함 인맥 꾸준 관리) 1단계. 고객 1명당 점검 등급·주기·다음 점검일·담당자·기억 메모를 둔다.
-- 새 표만 만들며 기존 자료는 바꾸지 않는다. 연락 이력은 기존 crm_activities(source='relationship')에 쌓는다.
-- 되돌리기: DROP TABLE IF EXISTS crm_relationship_care;
CREATE TABLE IF NOT EXISTS "crm_relationship_care" (
    "contact_id" uuid PRIMARY KEY NOT NULL REFERENCES "crm_contacts"("id") ON DELETE cascade,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
    "version" integer DEFAULT 1 NOT NULL,
    "tier" varchar(1) DEFAULT 'c' NOT NULL,
    "cadence_days" integer,
    "owner_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
    "met_place" varchar(200),
    "met_on" date,
    "memory_note" text DEFAULT '' NOT NULL,
    "important_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "last_touch_at" timestamp (3) with time zone,
    "next_due_at" timestamp (3) with time zone NOT NULL,
    "snoozed_until" timestamp (3) with time zone,
    "unanswered_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "crm_relationship_tier" CHECK ("tier" IN ('a','b','c','d')),
    CONSTRAINT "crm_relationship_cadence" CHECK ("cadence_days" IS NULL OR "cadence_days" BETWEEN 1 AND 730)
);
CREATE INDEX IF NOT EXISTS "crm_relationship_due" ON "crm_relationship_care" ("org_id", "workspace_id", "next_due_at");
CREATE INDEX IF NOT EXISTS "crm_relationship_owner_due" ON "crm_relationship_care" ("org_id", "workspace_id", "owner_user_id", "next_due_at");
