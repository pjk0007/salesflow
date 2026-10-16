-- dev의 0088_customer_inbox와 main의 0088_template_link_sender_pool은 원래 같은 시각이었다.
-- dev에서 뒤쪽 상담 마이그레이션까지 적용한 DB는 main의 과거 시각을 건너뛰므로,
-- 마지막 시각에 같은 nullable 칸을 추가한다. 기존 발신 설정과 이력은 변경하지 않는다.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "email_template_links" ADD COLUMN IF NOT EXISTS "sender_profile_id" integer;
--> statement-breakpoint
ALTER TABLE "email_template_links" ADD COLUMN IF NOT EXISTS "sender_profile_ids" jsonb;
