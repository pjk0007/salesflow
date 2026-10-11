-- 사업(워크스페이스)별 답장 받을 주소와 발송 이력의 실제 보낸 주소 (docs/2026-10-02-sender-warmup/DESIGN-3-reply-to.md 2절·4-1절)
-- 두 칸 모두 NULL 허용·기본값 없음이라 PostgreSQL 11 이상에서는 표를 다시 쓰지 않고 바로 끝난다 (email_send_logs가 커도 같다).
-- 다시 돌려도 같다 (IF NOT EXISTS).

-- 답장 받을 주소. 있으면 그 워크스페이스로 나가는 모든 메일에 Reply-To 헤더를 넣는다. NULL = 헤더 없음 (지금과 같음)
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "reply_to_email" varchar(200);

-- 보낼 때 실제로 쓴 발신 주소. 발신 프로필 주소를 나중에 바꿔도 이력의 보낸 주소는 그대로다.
-- 이 마이그레이션 전 로그는 NULL — 화면은 sender_profile_id로 프로필의 지금 주소를 "(현재 프로필)"과 함께 보인다
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "sender_email" varchar(200);
