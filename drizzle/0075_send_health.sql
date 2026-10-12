-- 발송 결과 자동 맞추기(SND-1)·발신 건강 판정과 멈춤(SND-3) — docs/2026-10-11-reply-and-health/DESIGN-SND.md 8절
-- 더하기만 한다. 새 칸은 NULL 허용이거나 상수 기본값이라 PostgreSQL 11 이상에서 표를 다시 쓰지 않는다.
-- 다시 돌려도 같다 (IF NOT EXISTS). 0074(회신 읽기, DESIGN-RPL) 뒤에 나간다. 한 트랜잭션이다.
-- email_send_logs에는 칸만 더하고 색인은 만들지 않는다 — 색인은 부팅 뒤 트랜잭션 밖에서 CONCURRENTLY로 (8-3, SND-15).
-- 잠금을 오래 기다리지 않는다: 큰 표 ALTER가 5초 안에 잠금을 못 얻으면 이 마이그레이션 묶음(밀린 것 전부, 한 트랜잭션)이
-- 되돌려진다. migrate.ts가 잠금 시간 초과(55P03)면 몇 번 다시 해 보고, 그래도 안 되면 서버를 띄우지 않고 끝낸다
-- (instrumentation.ts). 옛 스키마로 띄우면 schema.ts의 새 칸 때문에 발송 기록 insert가 모두 42703으로 실패한다 — 새 기능만
-- 쉬는 것이 아니라 모든 발송이 멈춘다 (F1·OPS-1).
SET LOCAL lock_timeout = '5s';

-- 1) 발송 기록: NHN 상태 코드와 실패 출처·실패 쪽
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "nhn_status_code" varchar(8);
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "nhn_checked_at" timestamp with time zone;
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "nhn_check_count" smallint DEFAULT 0 NOT NULL;     -- 3-3 보조 질문 횟수
-- 'nhn' = SST3, 'dsn' = 회신 메일함에 온 반송 안내. 먼저 온 쪽이 남는다 (한 기록에 실패는 한 번)
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "delivery_fail_source" varchar(8);
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "delivery_failed_at" timestamp with time zone;
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "delivery_status_code" varchar(16);  -- 5.1.1 같은 상태 (NHN dsnCode 또는 반송 안내 Status)
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "delivery_fail_side" varchar(10);    -- recipient | sender (SST7·8, 5.7.x·SPF·DKIM·DMARC)

-- 2) 명단 보류. 풀어도 줄을 남긴다 (언제·왜·누가 풀었나)
CREATE TABLE IF NOT EXISTS "email_partition_holds" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL,
    "partition_id" integer NOT NULL REFERENCES "partitions"("id") ON DELETE CASCADE,
    "scope" varchar(8) DEFAULT 'bulk' NOT NULL,            -- bulk(대량만, 자동 보류는 늘 이것) | all(나중의 손 보류)
    "source" varchar(10) DEFAULT 'auto' NOT NULL,          -- auto | manual(나중)
    "reason_code" varchar(30) NOT NULL,                    -- fail_rate
    "reason_text" text NOT NULL,                           -- 사람이 읽는 한 줄 (받는 주소 없음)
    "metrics" jsonb,
    "event_id" integer,
    "held_at" timestamp with time zone DEFAULT now() NOT NULL,
    "released_at" timestamp with time zone,
    "released_by" uuid,
    "release_note" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "eph_active_partition_idx" ON "email_partition_holds" ("partition_id") WHERE "released_at" IS NULL;
CREATE INDEX IF NOT EXISTS "eph_org_held_idx" ON "email_partition_holds" ("org_id", "held_at");
CREATE INDEX IF NOT EXISTS "eph_partition_released_idx" ON "email_partition_holds" ("partition_id", "released_at");

-- 3) 발신 주소: 누가 멈췄나, 건강 조치 방식, 재판정 시작
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "paused_source" varchar(10);      -- manual | auto
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "paused_reason" text;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "health_action" varchar(10) DEFAULT 'auto' NOT NULL; -- auto | alert (기본 주소는 코드가 늘 알림만)
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "health_reset_at" timestamp with time zone;
-- 이미 멈춰 있는 주소는 사람이 멈춘 것이다
UPDATE "email_sender_profiles" SET "paused_source" = 'manual' WHERE "is_paused" = true AND "paused_source" IS NULL;

-- 4) 반송 안내·스팸 신고 신호 (회신 읽기가 넘겨준 것, 4절). send_log_id는 FK 없음 — 큰 표에 잠금을 걸지 않게 (RPL email_replies와 같은 이유)
CREATE TABLE IF NOT EXISTS "email_bounce_signals" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "send_log_id" integer,
    "record_id" integer,                                   -- 이어진 발송의 레코드 (있을 때, RPL 사건용)
    "recipient_email" varchar(200) NOT NULL,               -- 소문자. Final-Recipient(없으면 Original). complaint는 이어진 발송의 받는 주소
    "original_recipient" varchar(200),
    "sender_email" varchar(200) NOT NULL,                  -- 소문자, 우리 발신 주소
    "dsn_action" varchar(16),
    "dsn_status" varchar(16),
    "diagnostic" text,                                     -- 앞 300자
    "kind" varchar(10) NOT NULL,                           -- hard | expired | soft | unknown | complaint
    "recipient_match" varchar(10),                         -- same | different | NULL(못 이음) — RPL M3
    "fail_side" varchar(10),                               -- recipient | sender
    "gmail_message_id" varchar(64) NOT NULL,
    "received_at" timestamp with time zone NOT NULL,
    "applied_at" timestamp with time zone,                 -- 발송 기록에 적용한 때. RPL dry_run이면 NULL (뒤에 applyPendingBounceSignals)
    "counted" boolean DEFAULT false NOT NULL,              -- 이 신호로 발송 기록이 처음 실패가 됐나
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ebs_message_recipient_idx" ON "email_bounce_signals" ("org_id", "gmail_message_id", "recipient_email");
CREATE INDEX IF NOT EXISTS "ebs_org_received_idx" ON "email_bounce_signals" ("org_id", "received_at");
-- RPL 7-4 보내기 직전 반송 막기 (조직·주소, hard만)
CREATE INDEX IF NOT EXISTS "ebs_org_recipient_idx" ON "email_bounce_signals" ("org_id", "recipient_email") WHERE "kind" = 'hard';

-- 5) 건강 사건 (감사 기록)
CREATE TABLE IF NOT EXISTS "email_health_events" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer,
    "entity_type" varchar(10) NOT NULL,                    -- partition | sender | domain | org
    "entity_id" integer,                                   -- 파티션 id·프로필 id (0 = 프로필 없는 기본 주소)
    "entity_key" varchar(220),                             -- 도메인 사건이면 도메인
    "kind" varchar(12) NOT NULL,                           -- danger | danger_with | auth_burst | release | report | cap | sync
    "level" varchar(8) NOT NULL,                           -- danger | caution | info
    "mode" varchar(8) NOT NULL,                            -- dry_run | alert | enforce
    "action" varchar(8) DEFAULT 'none' NOT NULL,           -- none | hold | pause | release
    "action_note" varchar(20),                             -- mode | opt_out | cap | cap_auth | no_profile | already | default_sender | sync_stale | sync_initial | unconfirmed_high
    "eval_window" varchar(4),                              -- 7d | 30d
    "dedupe_key" varchar(200) NOT NULL,
    "metrics" jsonb,
    "summary" text NOT NULL,
    "actor_user_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ehe_org_dedupe_idx" ON "email_health_events" ("org_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "ehe_org_created_idx" ON "email_health_events" ("org_id", "created_at");

-- 6) 알림 보낼 줄 — 한 회차의 새 사건을 조직·받는 곳마다 한 통으로 묶는다 (SND-13)
CREATE TABLE IF NOT EXISTS "email_health_alerts" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL,
    "batch_key" varchar(80) NOT NULL,                      -- run:<회차 시작 ms> | report:<날짜> | release:<…> | sync:<…>
    "event_ids" integer[] NOT NULL,
    "target" varchar(20) NOT NULL,                         -- ops | ws:<워크스페이스 id>
    "workspace_id" integer,
    "message" text NOT NULL,
    "status" varchar(12) DEFAULT 'pending' NOT NULL,       -- pending | processing | sent | failed | skipped | dry_run
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
    "locked_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "eha_org_batch_target_idx" ON "email_health_alerts" ("org_id", "batch_key", "target");
CREATE INDEX IF NOT EXISTS "eha_pickup_idx" ON "email_health_alerts" ("status", "scheduled_at", "id");

-- 7) 하루 건강 (대상별, 회차마다 오늘 줄을 덮어쓴다 — 날짜별로 남는다)
CREATE TABLE IF NOT EXISTS "email_health_daily" (
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "health_date" varchar(10) NOT NULL,                    -- KST "YYYY-MM-DD"
    "entity_key" varchar(220) NOT NULL,                    -- p:<id> | s:<id> | s:0 | d:<도메인>
    "workspace_id" integer,
    "final_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "sender_side_count" integer DEFAULT 0 NOT NULL,
    "nhn_unsub_count" integer DEFAULT 0 NOT NULL,
    "unknown_count" integer DEFAULT 0 NOT NULL,
    "dsn_only_count" integer DEFAULT 0 NOT NULL,
    "rate_bp" integer,
    "state" varchar(12) NOT NULL,                          -- ok | caution | danger | insufficient
    "eval_window" varchar(4) DEFAULT '7d' NOT NULL,        -- 7d | 30d (느린 명단)
    "reasons" jsonb,                                       -- 걸린 기준·주소×명단 칸 상위 10개(칸·나머지·p값)
    "window_start" timestamp with time zone NOT NULL,
    "evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("org_id", "health_date", "entity_key")
);

-- 8) NHN 결과 동기화 상태 (조직마다 한 줄. 같은 appKey 묶음은 대표 조직 줄의 커서를 따른다)
CREATE TABLE IF NOT EXISTS "email_status_sync_state" (
    "org_id" uuid PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
    "update_cursor" timestamp with time zone,              -- update-mails를 여기까지 다 읽었다 (3-2)
    "initial_from" timestamp with time zone,               -- 처음 커서 (now − 8일)
    "initial_done_at" timestamp with time zone,            -- 커서가 지금을 따라잡은 때. 비면 6-1 관문
    "last_run_at" timestamp with time zone,
    "last_ok_at" timestamp with time zone,
    "last_error" text,
    "last_error_code" varchar(20),                         -- auth | rate_limited | transient | config
    "consecutive_errors" integer DEFAULT 0 NOT NULL,
    "ops_alerted_at" timestamp with time zone,             -- 운영 알림 6시간 간격
    "stats" jsonb,                                         -- 마지막 회차 숫자: calls·windows·updated·unpaired·fallbackCalls·skippedWindows
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
