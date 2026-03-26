-- 후속 발송 다단계 체인: stepIndex 컬럼 추가 + 인덱스 변경
DO $$ BEGIN
    ALTER TABLE email_followup_queue ADD COLUMN step_index INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DROP INDEX IF EXISTS efq_parent_log_idx;
CREATE UNIQUE INDEX IF NOT EXISTS efq_parent_log_step_idx ON email_followup_queue(parent_log_id, step_index);
