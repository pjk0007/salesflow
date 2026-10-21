-- 0120 이메일 오픈 픽셀 (docs/2026-10-20-email-open-pixel/DESIGN.md 4절)
-- 1) email_send_logs.open_tracked: 본문에 오픈 픽셀을 넣어 보낸 발송. 기존 행은 false(픽셀 없음), 새 발송은 발송 코드가 true로 적는다.
--    상수 기본값 + NOT NULL이라 PostgreSQL 11 이상에서는 메타데이터만 바뀐다(attmissingval). 표를 다시 쓰지 않고 기존 행을 UPDATE하지 않는다.
--    운영이 11 이상인 근거: 0080의 RANGE 창(interval PRECEDING)이 운영에서 돌았다.
-- 2) email_open_logs: 픽셀 요청 한 건 = 한 줄. 발송당 사람 20줄·기계 10줄까지(src/lib/email-open-rules.ts). 판정은 앱(TS)이 하고 이 SQL에는 기준이 없다.
-- 3) 색인 (send_log_id, is_machine): 사람 오픈 EXISTS(is_machine = false)·발송별 수·상한 확인·cascade 삭제를 하나로 받는다. 새 표라 비어 있어 곧바로 만들어진다.
--    email_send_logs에는 색인을 만들지 않는다(큰 표 색인은 send-log-indexes.ts가 부팅 뒤 CONCURRENTLY로 만드는 관례).
-- 잠금: ALTER가 email_send_logs의 ACCESS EXCLUSIVE를 커밋까지 쥔다(수 ms). 가장 센 잠금을 먼저 잡아 FK가 같은 표를 잠글 때 잠금 올리기가 없게 한다.
-- 5초 안에 못 얻으면 55P03으로 되돌리고 migrate.ts가 다시 시도한다(0075·0078·0080·0082·0088과 같은 값). 다시 돌려도 같다(IF NOT EXISTS).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "open_tracked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_open_logs" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL,
    "send_log_id" integer NOT NULL REFERENCES "email_send_logs"("id") ON DELETE CASCADE,
    "opened_at" timestamptz DEFAULT now() NOT NULL,
    "ip" varchar(50),
    "user_agent" text,
    "is_machine" boolean NOT NULL,
    "machine_reason" varchar(16)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_open_logs_send_log_machine_idx" ON "email_open_logs" ("send_log_id", "is_machine");
--> statement-breakpoint
-- 9-2 F1: 집계 하위 질의가 조직·기간으로 오픈·클릭을 좁힌다. email_click_logs는 운영 3.6만 행(2026-10-21)이라 트랜잭션 안 CREATE INDEX도 짧다
CREATE INDEX IF NOT EXISTS "email_open_logs_org_opened_idx" ON "email_open_logs" ("org_id", "opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_click_logs_org_clicked_idx" ON "email_click_logs" ("org_id", "clicked_at");
