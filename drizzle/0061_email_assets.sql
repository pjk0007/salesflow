-- 이메일 에셋(이미지) — org(조직) 단위로 업로드·공유·재사용.
-- HTML 본문에 <img src>로 넣을 이미지를 저장한다.
-- 삭제 정책: DB row만 지우고 R2 파일은 남긴다(이미 발송된 메일의 이미지 보호).

CREATE TABLE IF NOT EXISTS "email_assets" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "name" varchar(200) NOT NULL,
    "url" varchar(500) NOT NULL,
    "r2_key" varchar(300) NOT NULL,
    "content_type" varchar(50) NOT NULL,
    "size" integer NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_assets_org_idx"
    ON "email_assets" ("org_id");

-- AI 자동발송 규칙에 연결할 에셋 id 목록. null/[]이면 이미지 없음.
ALTER TABLE "email_auto_personalized_links"
    ADD COLUMN IF NOT EXISTS "asset_ids" jsonb;
