-- 회신 받기 (docs/2026-10-11-reply-and-health/DESIGN-RPL.md 9절). 새 표 둘과 NULL 허용 칸 둘만 더한다.
-- 큰 표(email_send_logs)는 건드리지 않는다. 그 표의 (org_id, sent_at)·(request_id) 색인은 부팅 뒤 트랜잭션 밖 단계가
-- CREATE INDEX CONCURRENTLY로 만든다 (DESIGN-SND 8-3 ensureSendLogIndexes — 두 문서 같은 결론)
-- 다시 돌려도 같다 (IF NOT EXISTS). 새 칸은 NULL 허용이라 PostgreSQL 11 이상에서 표를 다시 쓰지 않는다.

CREATE TABLE IF NOT EXISTS "email_replies" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,   -- 애매함이면 NULL
    "workspace_id" integer,
    "workspace_guessed" boolean DEFAULT false NOT NULL,                  -- 못 이었지만 발신 주소로 사업을 추정 (6-3)
    "record_id" integer REFERENCES "records"("id") ON DELETE SET NULL,   -- 레코드를 지워도 막기 기록은 남긴다. 넣을 때는 records에 있는 것만 (6-1 LEFT JOIN, M6)
    "send_log_id" integer,                                               -- FK 없음 (깊이 알림과 같은 이유)
    "root_log_id" integer,
    "rule_kind" varchar(10),                                             -- ai | template | manual
    "rule_id" integer,
    "step_index" integer,                                                -- 0 = 첫 메일, n = n번째 후속
    "mailbox" varchar(200) NOT NULL,
    "gmail_message_id" varchar(64) NOT NULL,
    "gmail_thread_id" varchar(64),
    "rfc_message_id" varchar(300),
    "from_email" varchar(200) NOT NULL,                                  -- 정규화
    "from_name" varchar(200),
    "to_email" varchar(200) NOT NULL,                                    -- 받은 우리 주소
    "contact_email" varchar(200) NOT NULL,                               -- 사람·자동응답 = 보낸 사람, 반송 = 반송된 받는 주소 (Final → Original)
    "matched_recipient" varchar(200),                                    -- 이어진 발송의 받는 주소(원래 받은 사람). 멈춤·막기는 contact_email과 둘 다 (M3)
    "subject" varchar(300),
    "excerpt" text,                                                      -- 인용 뗀 앞 500자. 반송·시스템·큰 메일은 NULL
    "kind" varchar(20) NOT NULL,                                         -- human | auto_reply | bounce | system | internal | unknown
    "bounce_type" varchar(10),                                           -- hard | expired | soft | unknown (SND classifyDsn 하나로)
    "dsn_status" varchar(20),
    "dsn_diagnostic" varchar(300),
    "unsubscribe_hint" boolean DEFAULT false NOT NULL,
    "ours_reason" varchar(20) NOT NULL,                                  -- address | domain_thread
    "match_status" varchar(20) NOT NULL,                                 -- matched | unmatched | ambiguous
    "match_method" varchar(20),                                          -- thread | dsn_headers | fallback_subject | fallback_latest | fallback_from_only | fallback_multi_ws | dsn_fallback
    "received_at" timestamp with time zone NOT NULL,                     -- Gmail internalDate
    "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
    "detected_mode" varchar(10) NOT NULL,                                -- dry_run | on
    "process_error" varchar(80),                                         -- 메일 하나의 데이터 오류 (SQLSTATE·제약 이름만, M6)
    "effects_applied_at" timestamp with time zone,
    "effects_applied_kind" varchar(20),                                  -- 효과를 적용할 때의 kind. 사람으로 고치면 다시 적용 (M5)
    "effects" jsonb,
    "stop_automation" boolean DEFAULT true NOT NULL,                     -- 담당이 끄면 보내기 직전 막기에서 빠진다
    "alert_status" varchar(20),                                          -- NULL(대상 아님) | pending | processing | sent | failed | skipped | dry_run
    "alert_attempts" integer DEFAULT 0 NOT NULL,
    "alert_next_at" timestamp with time zone,
    "alert_locked_at" timestamp with time zone,
    "alert_message" text,
    "alert_last_error" text,
    "alert_sent_at" timestamp with time zone,
    "handled_by" uuid,
    "handled_at" timestamp with time zone,
    "kind_changed_by" uuid,
    "kind_changed_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "er_mailbox_gmail_idx" ON "email_replies" ("mailbox", "gmail_message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "er_org_rfc_idx" ON "email_replies" ("org_id", "rfc_message_id")
    WHERE "org_id" IS NOT NULL AND "rfc_message_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "er_stop_idx" ON "email_replies" ("workspace_id", "contact_email");
CREATE INDEX IF NOT EXISTS "er_stop_recipient_idx" ON "email_replies" ("workspace_id", "matched_recipient")
    WHERE "matched_recipient" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "er_send_log_idx" ON "email_replies" ("send_log_id");
CREATE INDEX IF NOT EXISTS "er_record_idx" ON "email_replies" ("record_id");
CREATE INDEX IF NOT EXISTS "er_org_received_idx" ON "email_replies" ("org_id", "received_at");
CREATE INDEX IF NOT EXISTS "er_alert_pickup_idx" ON "email_replies" ("alert_status", "alert_next_at", "id");

-- 메일함마다 어디까지 읽었나. 남의 메일에 대해서는 건수(stats)만 남는다
CREATE TABLE IF NOT EXISTS "email_reply_mailbox_state" (
    "mailbox" varchar(200) PRIMARY KEY NOT NULL,
    "history_id" varchar(32),
    "backfill_after" timestamp with time zone,
    "backfill_before" timestamp with time zone,
    "backfill_done_at" timestamp with time zone,
    "last_run_at" timestamp with time zone,
    "last_success_at" timestamp with time zone,
    "last_error_code" varchar(30),       -- auth | scope | mailbox_mismatch | rate_limited | transient | config | stale
    "last_error" text,                    -- 한국어 한 줄. 비밀값·주소 없음
    "last_error_at" timestamp with time zone,
    "ops_alerted_at" timestamp with time zone,
    "stats" jsonb,                        -- 마지막 회차와 오늘(KST) 누적 숫자: listed·notOurs·notAllowedFrom·outOfScope·ours·stored·matched·dbErrors …
                                          -- + excluded(뺀 주소, 가린 모양 — B1)·serverKind(production | test)
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 멈춤 사유 (replied | bounced). SEQ-1이 같은 칸에 rule_off·first_failed·unsubscribed·manual을 쓴다
ALTER TABLE "email_followup_queue" ADD COLUMN IF NOT EXISTS "stop_reason" varchar(30);
ALTER TABLE "email_automation_queue" ADD COLUMN IF NOT EXISTS "stop_reason" varchar(30);
