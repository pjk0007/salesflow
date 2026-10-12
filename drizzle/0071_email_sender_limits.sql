-- 발신 주소 웜업·하루 한도·분산 발송 (docs/2026-10-02-sender-warmup/DESIGN.md 4절)
-- 새 칸은 전부 기본값이 "꺼짐"이다 — 한도를 하나도 켜지 않은 주소와 주소가 하나인 규칙은 지금과 똑같이 나간다.
-- 0070(깊이 들어온 사람 알림) 뒤에 나간다. 마이그레이션은 한 트랜잭션이라 여기서 실패하면 0070도 함께 되돌아간다.

-- email_sender_profiles: 한도 칸 (전부 기본값이 "꺼짐"이라 기존 주소는 그대로 나간다)
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "daily_limit" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "warmup_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "warmup_start_count" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "warmup_step" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "warmup_started_on" varchar(10);
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "send_window_start" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "send_window_end" integer;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "weekdays_only" boolean DEFAULT false NOT NULL;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "spread_evenly" boolean DEFAULT false NOT NULL;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "is_paused" boolean DEFAULT false NOT NULL;

-- 주소별 하루 사용량 (KST 날짜). 예약 수를 센다 — 로그를 세지 않는다
-- usage_date를 date 형으로 두지 않는다 — DB 세션 시간대에 따라 날짜가 바뀔 수 있다
CREATE TABLE IF NOT EXISTS "email_sender_daily_usage" (
    "sender_profile_id" integer NOT NULL REFERENCES "email_sender_profiles"("id") ON DELETE CASCADE,
    "usage_date" varchar(10) NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "last_sent_at" timestamp with time zone,
    PRIMARY KEY ("sender_profile_id", "usage_date")
);

-- AI 규칙의 발신 주소 묶음 (순서 있음). sender_profile_id는 첫 원소로 맞춰 둔다
ALTER TABLE "email_auto_personalized_links" ADD COLUMN IF NOT EXISTS "sender_profile_ids" jsonb;

-- 후속 대기열 잠금 (processing 상태와 회수용)
ALTER TABLE "email_followup_queue" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;

-- 템플릿 자동 첫 메일을 미룰 때 반복 대기열에 'first'로 넣는다
ALTER TABLE "email_automation_queue" ADD COLUMN IF NOT EXISTS "kind" varchar(10) DEFAULT 'repeat' NOT NULL;

-- 발송 대기열: 시도 횟수를 다 쓴 AI 규칙 id. 앞 규칙 실패 + 뒤 규칙 미룸인 줄을 failed로 닫지 않고
-- 실패한 규칙만 빼서 미룬 규칙을 retryAt에 다시 시도한다 (email-send-queue-rules.ts planQueueRow)
ALTER TABLE "email_send_queue" ADD COLUMN IF NOT EXISTS "exhausted_link_ids" jsonb;

-- 발송 대기열: 워커가 처리하는 사이 바로 보내는 경로가 남긴 "다시 처리" 시각 (enqueueDeferredSend).
-- 워커가 보낼 것 없음·실패로 끝내려 할 때 이 값이 있으면 끝내지 않고 이 시각에 다시 꺼낸다
ALTER TABLE "email_send_queue" ADD COLUMN IF NOT EXISTS "requeue_at" timestamp with time zone;
