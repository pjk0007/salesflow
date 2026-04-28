-- 알림톡 후속발송 다단계 체인 지원
-- followup_queue: step_index 추가 + (parent_log_id, step_index) UNIQUE 인덱스
-- send_logs: step_index 추가 (auto=0, followup step N = N+1)

DO $$ BEGIN
    ALTER TABLE alimtalk_followup_queue ADD COLUMN step_index integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS alfq_parent_log_step_idx
ON alimtalk_followup_queue (parent_log_id, step_index);

DO $$ BEGIN
    ALTER TABLE alimtalk_send_logs ADD COLUMN step_index integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
