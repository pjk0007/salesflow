-- 사업부별 상담 담당자 (상담 설정 › 상담 담당자의 상담권한 토글)
CREATE TABLE IF NOT EXISTS "inbox_responders" (
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("workspace_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_responders_org" ON "inbox_responders" ("org_id");
--> statement-breakpoint
-- 처음엔 지금 상담할 수 있는 사람(조직 관리자·응대·운영 관리 권한)을 상담창이 있는 사업마다 켜 둔다. 이후 토글로 끈다
INSERT INTO "inbox_responders" ("org_id", "workspace_id", "user_id")
SELECT DISTINCT c."org_id", c."workspace_id", om."user_id"
FROM "inbox_channels" c
JOIN "organization_members" om ON om."organization_id" = c."org_id"
JOIN "users" u ON u."id" = om."user_id" AND u."is_active" = 1
LEFT JOIN "customer_workspace_access" a
    ON a."org_id" = c."org_id" AND a."workspace_id" = c."workspace_id" AND a."user_id" = om."user_id"
WHERE om."role" <> 'member' OR a."role" IN ('agent', 'manager')
ON CONFLICT DO NOTHING;
