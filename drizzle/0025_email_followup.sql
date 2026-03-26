-- 1. emailTemplateLinks에 followupConfig 추가
DO $$ BEGIN
    ALTER TABLE email_template_links ADD COLUMN followup_config jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 2. emailAutoPersonalizedLinks에 followupConfig 추가
DO $$ BEGIN
    ALTER TABLE email_auto_personalized_links ADD COLUMN followup_config jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 3. emailSendLogs에 parentLogId 추가
DO $$ BEGIN
    ALTER TABLE email_send_logs ADD COLUMN parent_log_id integer;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 4. emailFollowupQueue 생성
CREATE TABLE IF NOT EXISTS email_followup_queue (
    id serial PRIMARY KEY,
    parent_log_id integer NOT NULL REFERENCES email_send_logs(id) ON DELETE CASCADE,
    source_type varchar(20) NOT NULL,
    source_id integer NOT NULL,
    org_id uuid NOT NULL,
    check_at timestamptz NOT NULL,
    status varchar(20) DEFAULT 'pending' NOT NULL,
    result varchar(20),
    processed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS efq_status_check_idx ON email_followup_queue (status, check_at);
DROP INDEX IF EXISTS efq_parent_log_idx;
CREATE UNIQUE INDEX IF NOT EXISTS efq_parent_log_idx ON email_followup_queue (parent_log_id);
