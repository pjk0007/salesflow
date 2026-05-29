-- 사이트별 이벤트 이름 별칭(라벨) 매핑.
-- 운영자가 SECTION_VIEW/CLICK 이벤트의 raw 이름(hero, service-cta 등)에
-- 한글 라벨(메인 소개, 가격 → 가입 CTA 등)을 매핑해 마케팅 화면에서 표시.
CREATE TABLE IF NOT EXISTS "tracker_event_aliases" (
    "id"         serial PRIMARY KEY,
    "org_id"     uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "site_id"    integer NOT NULL REFERENCES "tracker_sites"("id") ON DELETE CASCADE,
    "event_type" varchar(30) NOT NULL,
    "event_name" varchar(100) NOT NULL,
    "label"      varchar(200) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "tracker_event_aliases_site_type_name_unique"
        UNIQUE ("site_id", "event_type", "event_name")
);
CREATE INDEX IF NOT EXISTS "tracker_event_aliases_site_idx"
    ON "tracker_event_aliases" ("site_id");
