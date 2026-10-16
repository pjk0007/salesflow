-- 템플릿 자동발송 연결의 발신 주소 묶음 (docs/2026-10-16-template-link-sender/DESIGN.md)
-- AI 규칙(email_auto_personalized_links)과 같은 두 칸이다. sender_profile_id = 묶음의 첫 주소, sender_profile_ids = 고른 순서의 묶음.
-- 외래 키를 두지 않는다 (AI 규칙과 같음) — 프로필을 지워도 연결은 남고, 발송 때 이 조직에 없는 id는 빠져 기본 주소로 나간다.
-- 두 칸 모두 NULL 허용·기본값 없음이라 표를 다시 쓰지 않는다. 기존 연결은 두 칸이 NULL = 지금처럼 기본 발신 주소.
-- 잠금을 5초 안에 못 얻으면 55P03으로 되돌리고 migrate.ts가 다시 시도한다 (0075·0078·0080·0082와 같은 값). 다시 돌려도 같다 (IF NOT EXISTS).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "email_template_links" ADD COLUMN IF NOT EXISTS "sender_profile_id" integer;
--> statement-breakpoint
ALTER TABLE "email_template_links" ADD COLUMN IF NOT EXISTS "sender_profile_ids" jsonb;
