-- 트래커 사이트 분석에서 제외할 경로 패턴 (인기 페이지 등 집계에서 제외)
-- 예: ["/main/", "/login/"] — prefix 매칭 기준
ALTER TABLE "tracker_sites" ADD COLUMN IF NOT EXISTS "exclude_paths" jsonb NOT NULL DEFAULT '[]'::jsonb;
