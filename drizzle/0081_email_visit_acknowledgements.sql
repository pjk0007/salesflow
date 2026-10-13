SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS email_visit_acknowledgements (
    id serial PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    customer_key varchar(64) NOT NULL,
    source_log_id integer NOT NULL REFERENCES email_send_logs(id) ON DELETE CASCADE,
    record_id integer NOT NULL,
    session_id integer NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('ignored','pending','uncertain','sent','failed','cancelled')),
    reason text,
    queue_id integer REFERENCES email_followup_queue(id) ON DELETE SET NULL,
    send_log_id integer REFERENCES email_send_logs(id) ON DELETE SET NULL,
    scheduled_at timestamptz NOT NULL,
    observed_at timestamptz NOT NULL,
    next_check_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT eva_customer_idx UNIQUE (org_id, workspace_id, customer_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS eva_status_check_idx ON email_visit_acknowledgements(status, next_check_at);
