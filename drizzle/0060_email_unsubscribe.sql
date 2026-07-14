-- 이메일 수신거부(unsubscribe)
-- 거부 범위는 워크스페이스 단위. 한 번 거부하면 해당 워크스페이스가 보내는
-- 모든 메일(수동/자동/AI/후속)에서 제외된다.

-- 1) 수신거부 원장
CREATE TABLE IF NOT EXISTS "email_unsubscribes" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "email" varchar(200) NOT NULL,
    "send_log_id" integer REFERENCES "email_send_logs"("id") ON DELETE SET NULL,
    "record_id" integer,
    "source" varchar(20) NOT NULL DEFAULT 'link',
    "reason" text,
    "unsubscribed_at" timestamptz NOT NULL DEFAULT now()
);

-- 발송 전 차단 조회의 핵심 인덱스. 재거부 시 중복 INSERT 방지도 겸함.
CREATE UNIQUE INDEX IF NOT EXISTS "email_unsubscribes_workspace_email_idx"
    ON "email_unsubscribes" ("workspace_id", lower("email"));

-- 2) 발송 로그에 수신거부 토큰. email_click_logs.click_id와 동일 패턴.
--    메일 본문의 수신거부 링크가 이 토큰으로 발송 건을 되짚는다.
ALTER TABLE "email_send_logs"
    ADD COLUMN IF NOT EXISTS "unsubscribe_token" varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS "email_send_logs_unsubscribe_token_idx"
    ON "email_send_logs" ("unsubscribe_token");

-- 3) 수신거부 링크 삽입 토글
--    템플릿 기반 발송은 email_templates, AI 개인화 발송은 규칙(link)에 둔다.
ALTER TABLE "email_templates"
    ADD COLUMN IF NOT EXISTS "use_unsubscribe" integer NOT NULL DEFAULT 0;

ALTER TABLE "email_auto_personalized_links"
    ADD COLUMN IF NOT EXISTS "use_unsubscribe" integer NOT NULL DEFAULT 0;
