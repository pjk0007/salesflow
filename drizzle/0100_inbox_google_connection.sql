CREATE TABLE inbox_google_connections (
 mailbox_id uuid PRIMARY KEY REFERENCES inbox_mailboxes(id), version integer NOT NULL DEFAULT 1,
 status varchar(16) NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','reconnect','disconnected')),
 client_id varchar(500), refresh_cipher text, connected_by uuid REFERENCES users(id), connected_at timestamptz(3), since timestamptz(3),
 phase varchar(16) NOT NULL DEFAULT 'full' CHECK(phase IN ('full','history')), history_id varchar(128), baseline_history_id varchar(128), page_token text,
 action varchar(16) NOT NULL DEFAULT 'poll' CHECK(action IN ('poll','receive','files','send')), file_cursor uuid,
 lease_token uuid, lease_until timestamptz(3), next_run_at timestamptz(3) NOT NULL DEFAULT now(), last_poll_at timestamptz(3), last_processed_at timestamptz(3), error_code varchar(50), failures integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX inbox_google_due ON inbox_google_connections(status,next_run_at);
--> statement-breakpoint
CREATE TABLE inbox_google_oauth_states (
 state_hash varchar(64) PRIMARY KEY, mailbox_id uuid NOT NULL REFERENCES inbox_mailboxes(id), org_id uuid NOT NULL REFERENCES organizations(id), actor_id uuid NOT NULL REFERENCES users(id), mailbox_version integer NOT NULL,
 cookie_hash varchar(64) NOT NULL, verifier_cipher text NOT NULL, since timestamptz(3) NOT NULL, expires_at timestamptz(3) NOT NULL, used_at timestamptz(3)
);
--> statement-breakpoint
CREATE TABLE inbox_google_sync_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),mailbox_id uuid NOT NULL REFERENCES inbox_mailboxes(id),connection_version integer NOT NULL,provider_message_id varchar(200) NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','done','skipped','failed')),reason_code varchar(50),receipt_id uuid REFERENCES inbox_email_receipts(id),attempts integer NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz(3),eligible_at timestamptz(3) NOT NULL DEFAULT now(),created_at timestamptz(3) NOT NULL DEFAULT now(),updated_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_google_source_once ON inbox_google_sync_jobs(mailbox_id,provider_message_id);
--> statement-breakpoint
CREATE INDEX inbox_google_job_due ON inbox_google_sync_jobs(mailbox_id,state,eligible_at);
