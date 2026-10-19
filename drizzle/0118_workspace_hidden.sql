-- 워크스페이스 숨김: 쓰지 않는 사업을 지우지 않고 선택 목록에서만 뺀다
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;
