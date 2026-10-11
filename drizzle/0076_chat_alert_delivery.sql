-- 구글 챗 알림 전달 상태 (구글 챗 QA 반영) — docs/2026-10-11-reply-and-health/CHAT-QA.md
-- 더하기만 한다. 새 표와 NULL 허용 칸이라 큰 표를 다시 쓰지 않는다. 다시 돌려도 같다 (IF NOT EXISTS). 한 트랜잭션이다.
SET LOCAL lock_timeout = '5s';

-- 1) 웹훅(받는 곳)마다 전달 상태 (WPN-1~5). 웹훅을 정하는 환경 변수 이름 하나가 한 줄이다 — 주소(비밀값)는 넣지 않는다.
--    깊이·회신·발송 건강·운영 알림이 함께 쓰고, 문제가 생기면 운영 스페이스에 6시간에 한 번, 고쳐지면 한 번 알린다
CREATE TABLE IF NOT EXISTS "chat_webhook_status" (
    "source" varchar(80) PRIMARY KEY,                     -- DEEP_ALERT_WEBHOOK_URL_7 · SEND_HEALTH_WEBHOOK_URL · REPLY_OPS_WEBHOOK_URL …
    "workspace_id" integer,                                -- 사업 스페이스면 그 워크스페이스, 운영이면 NULL
    "kind" varchar(12),                                    -- 지금 문제: config(401·403·404) · missing · invalid · unreachable(연결 실패·5xx가 이어짐) · NULL(정상)
    "last_status" integer,
    "last_error" text,                                     -- 한국어 한 줄 (주소·key·token 없음)
    "problem_since" timestamp with time zone,
    "last_ok_at" timestamp with time zone,
    "last_fail_at" timestamp with time zone,
    "ops_alerted_at" timestamp with time zone,             -- 운영 스페이스에 알린 때 (6시간에 한 번)
    "ops_alerted_kind" varchar(12),
    "url_hash" varchar(16),                                -- 문제가 난 주소의 지문 (sha256 앞 16자, 주소는 되살릴 수 없음) — 주소를 바꿔 배포하면 고장 표시를 믿지 않고 바로 다시 보낸다
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "chat_webhook_status" ADD COLUMN IF NOT EXISTS "url_hash" varchar(16);

-- 2) 회신 읽기 운영 알림 (RO-6·RO-7·RO-15): 마지막으로 알린 원인, 회복 글 빚(보내기 실패하면 다음 회차에 다시), 마지막 회복 때
ALTER TABLE "email_reply_mailbox_state" ADD COLUMN IF NOT EXISTS "ops_alerted_code" varchar(30);
ALTER TABLE "email_reply_mailbox_state" ADD COLUMN IF NOT EXISTS "ops_recovery_code" varchar(30);
ALTER TABLE "email_reply_mailbox_state" ADD COLUMN IF NOT EXISTS "ops_recovered_at" timestamp with time zone;

-- 3) NHN 결과 확인 운영 알림 (HS-1·HS-6): 마지막으로 알린 원인 (auth | stale) — 같은 원인은 마지막 알림 6시간 뒤에 다시
ALTER TABLE "email_status_sync_state" ADD COLUMN IF NOT EXISTS "ops_alerted_cause" varchar(12);
