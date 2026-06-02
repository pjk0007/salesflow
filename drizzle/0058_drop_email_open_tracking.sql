-- 수신확인(open) 추적 제거 — 정확도가 낮아 링크 클릭 기준으로 대체됨.
-- email_send_logs 의 is_opened / opened_at 컬럼 삭제.
ALTER TABLE "email_send_logs" DROP COLUMN IF EXISTS "is_opened";
ALTER TABLE "email_send_logs" DROP COLUMN IF EXISTS "opened_at";
