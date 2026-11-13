-- 사람별 화면 설정 (예: 리드젠통계 사업부 탭 순서 {"tabOrder": {"leadgen-stats": [3, 1, 2]}})
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;
