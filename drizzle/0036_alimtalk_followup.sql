-- alimtalkTemplateLinks에 followupConfig 추가
DO $$ BEGIN
    ALTER TABLE alimtalk_template_links ADD COLUMN followup_config jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 알림톡 후속발송 큐
CREATE TABLE IF NOT EXISTS alimtalk_followup_queue (
    id serial PRIMARY KEY,
    parent_log_id integer NOT NULL REFERENCES alimtalk_send_logs(id) ON DELETE CASCADE,
    template_link_id integer NOT NULL REFERENCES alimtalk_template_links(id) ON DELETE CASCADE,
    org_id uuid NOT NULL,
    send_at timestamptz NOT NULL,
    status varchar(20) DEFAULT 'pending' NOT NULL,
    processed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS alfq_status_send_idx ON alimtalk_followup_queue (status, send_at);
