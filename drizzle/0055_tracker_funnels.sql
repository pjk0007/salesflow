-- 사이트별 사용자정의 퍼널 — "방문/리드"는 자동, 3단부터 stages jsonb에 저장
CREATE TABLE IF NOT EXISTS "tracker_funnels" (
    "id"         serial PRIMARY KEY,
    "org_id"     uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "site_id"    integer NOT NULL REFERENCES "tracker_sites"("id") ON DELETE CASCADE,
    "name"       varchar(200) NOT NULL,
    "stages"     jsonb NOT NULL DEFAULT '[]'::jsonb,
    "is_default" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tracker_funnels_site_idx" ON "tracker_funnels" ("site_id");
