-- 트래커 식별 매칭 필드
-- identify 시 어떤 필드로 records를 매칭할지 지정. NULL이면 email/phone 기본.
ALTER TABLE "tracker_sites"
    ADD COLUMN IF NOT EXISTS "match_field" varchar(100);
