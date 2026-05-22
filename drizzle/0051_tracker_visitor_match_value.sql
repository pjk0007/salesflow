-- 트래커 visitor가 식별된 matchField 값을 보존 (양방향 매칭용)
-- identify 수신 시 user_id(=site.matchField 값)를 저장 → record 생성 시 역매칭 키로 재사용
ALTER TABLE "tracker_visitors" ADD COLUMN IF NOT EXISTS "match_value" varchar(200);
CREATE INDEX IF NOT EXISTS "tracker_visitors_match_value_idx" ON "tracker_visitors" ("site_id", "match_value");
