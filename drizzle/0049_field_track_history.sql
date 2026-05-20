-- field_definitions에 변경 이력 추적 플래그 추가
-- 1이면 이 필드가 sendb UI에서 바뀔 때 record_events에 이력 기록 (주로 select 타입)
ALTER TABLE "field_definitions" ADD COLUMN IF NOT EXISTS "track_history" integer DEFAULT 0 NOT NULL;
