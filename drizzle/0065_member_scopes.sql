-- 조직 member 역할 사용자에게 파티션 단위 권한을 부여한다.
-- allow 기본: 어떤 파티션을 덮는 행이 하나도 없으면 그 파티션은 전체 허용(기존 동작 유지).
-- scope_id는 다형 참조(workspace/folder/partition)라 FK를 걸지 않는다. org 스코프는 0으로 정규화.

CREATE TABLE IF NOT EXISTS "member_scopes" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "scope_type" varchar(20) NOT NULL,
    "scope_id" integer NOT NULL,
    "permissions" jsonb NOT NULL,
    "granted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "member_scopes_org_user_scope_unique" UNIQUE ("org_id", "user_id", "scope_type", "scope_id")
);

CREATE INDEX IF NOT EXISTS "member_scopes_org_idx" ON "member_scopes" ("org_id");
