-- 레코드 생성 구글챗 알림: 조직별 스페이스 등록 + 파티션별 알림 스페이스 선택
CREATE TABLE IF NOT EXISTS "chat_spaces" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "name" varchar(100) NOT NULL,
    "webhook_url" text NOT NULL,
    "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "chat_spaces_org_id_name_unique" UNIQUE ("org_id", "name")
);
--> statement-breakpoint
ALTER TABLE "partitions" ADD COLUMN IF NOT EXISTS "chat_space_id" integer REFERENCES "chat_spaces"("id") ON DELETE SET NULL;
