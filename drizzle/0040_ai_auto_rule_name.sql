-- AI 자동발송 규칙에 name 컬럼 추가
ALTER TABLE "email_auto_personalized_links" ADD COLUMN "name" varchar(100);

-- 발송 로그에 AI 자동발송 규칙 FK 추가
ALTER TABLE "email_send_logs" ADD COLUMN "auto_personalized_link_id" integer REFERENCES "email_auto_personalized_links"("id") ON DELETE SET NULL;
