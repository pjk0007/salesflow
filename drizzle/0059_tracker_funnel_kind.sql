-- 퍼널 종류 구분: 'marketing'(기존, 상태 기반 + cumulative 역산) / 'event'(행동, custom_event 단계만, 역산 미적용).
-- default 'marketing' → 기존 row·쿼리 동작 불변.
ALTER TABLE "tracker_funnels"
    ADD COLUMN IF NOT EXISTS "kind" varchar(20) NOT NULL DEFAULT 'marketing';
