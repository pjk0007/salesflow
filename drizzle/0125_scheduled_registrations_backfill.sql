-- 예약 등록 표·칸을 만드는 SQL이 저장소에 없던 문제 보정.
-- 커밋 eadfac7(2026-06-16 "예약 등록 기능 추가")이 src/lib/db/schema.ts에 scheduled_registrations 표와
-- partitions.scheduled_registration_config 칸을 넣었지만 drizzle/*.sql에는 만드는 문장이 없어, 새 DB에서는
-- 파티션 생성이 42703으로 실패한다. 운영 DB에는 다른 경로로 이미 있을 수 있어 모두 IF NOT EXISTS로 쓴다(있으면 아무 일 없음).
ALTER TABLE "partitions" ADD COLUMN IF NOT EXISTS "scheduled_registration_config" jsonb;
CREATE TABLE IF NOT EXISTS "scheduled_registrations" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "partition_id" integer NOT NULL REFERENCES "partitions"("id") ON DELETE CASCADE,
    "data" jsonb NOT NULL,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,
    "record_id" integer,
    "source_file_name" varchar(300),
    "error_message" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "registered_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "scheduled_registrations_pickup_idx" ON "scheduled_registrations" ("partition_id", "status", "id");
