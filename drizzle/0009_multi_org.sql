-- 1. organizationMembers 테이블 생성
CREATE TABLE IF NOT EXISTS "organization_members" (
    "id" serial PRIMARY KEY,
    "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "role" varchar(20) NOT NULL,
    "joined_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "organization_members_organization_id_user_id_unique" UNIQUE("organization_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "org_members_user_idx" ON "organization_members"("user_id");

-- 2. 기존 데이터 마이그레이션 (users.orgId + role → organizationMembers)
INSERT INTO "organization_members" ("organization_id", "user_id", "role", "joined_at")
SELECT "org_id", "id", "role", "created_at"
FROM "users"
WHERE "org_id" IS NOT NULL
ON CONFLICT ("organization_id", "user_id") DO NOTHING;

-- 3. users.orgId nullable로 변경
ALTER TABLE "users" ALTER COLUMN "org_id" DROP NOT NULL;
