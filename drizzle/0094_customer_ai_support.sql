ALTER TABLE inbox_conversations ADD COLUMN ai_state varchar(16) NOT NULL DEFAULT 'auto' CHECK(ai_state IN ('auto','human'));
ALTER TABLE inbox_conversations ADD COLUMN ai_handoff_reason varchar(300);
ALTER TABLE inbox_messages ADD COLUMN ai_draft_id uuid;
--> statement-breakpoint
CREATE TABLE customer_ai_settings (
 workspace_id integer PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1,mode varchar(16) NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','draft','reply')),
 knowledge_version_id integer REFERENCES ai_copy_knowledge_versions(id),model varchar(100) NOT NULL,instructions text NOT NULL,
 handoff_assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,handoff_message varchar(500) NOT NULL,max_jobs_per_day integer NOT NULL DEFAULT 50,
 changed_by uuid REFERENCES users(id) ON DELETE SET NULL,updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE customer_ai_settings_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 version integer NOT NULL,actor_name varchar(100) NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE customer_ai_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,client_id uuid NOT NULL,source_message_id integer NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
 last_public_id integer NOT NULL,mode varchar(16) NOT NULL,settings_version integer NOT NULL,settings_snapshot jsonb NOT NULL,
 knowledge_version_id integer REFERENCES ai_copy_knowledge_versions(id),knowledge_fingerprint varchar(64),sources jsonb NOT NULL DEFAULT '[]',context jsonb NOT NULL,
 state varchar(20) NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','generating','ready','handed_off','failed','stale','sent','cancelled')),
 reason varchar(300),answer text,citations jsonb NOT NULL DEFAULT '[]',attempts integer NOT NULL DEFAULT 0,lease_id uuid,lease_until timestamptz(3),eligible_at timestamptz(3) NOT NULL DEFAULT now(),
 requested_by uuid REFERENCES users(id) ON DELETE SET NULL,sent_by uuid REFERENCES users(id) ON DELETE SET NULL,sent_message_id integer REFERENCES inbox_messages(id),
 created_at timestamptz(3) NOT NULL DEFAULT now(),updated_at timestamptz(3) NOT NULL DEFAULT now(),UNIQUE(conversation_id,client_id)
);
ALTER TABLE inbox_messages ADD CONSTRAINT inbox_ai_draft_fk FOREIGN KEY(ai_draft_id) REFERENCES customer_ai_jobs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX inbox_ai_draft_once ON inbox_messages(ai_draft_id) WHERE ai_draft_id IS NOT NULL;
CREATE INDEX customer_ai_due ON customer_ai_jobs(state,eligible_at,lease_until);
CREATE INDEX customer_ai_conversation ON customer_ai_jobs(conversation_id,created_at,id);
--> statement-breakpoint
CREATE TABLE customer_ai_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES customer_ai_jobs(id) ON DELETE CASCADE,lease_id uuid NOT NULL,stage varchar(16) NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'running',provider varchar(30) NOT NULL,model varchar(100) NOT NULL,
 prompt_tokens integer,completion_tokens integer,charged_prompt integer NOT NULL DEFAULT 0,charged_completion integer NOT NULL DEFAULT 0,usage_log_id integer REFERENCES ai_usage_logs(id),
 started_at timestamptz(3) NOT NULL DEFAULT now(),finished_at timestamptz(3),UNIQUE(job_id,lease_id,stage)
);
CREATE TABLE customer_ai_daily_usage (
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,day date NOT NULL,jobs integer NOT NULL DEFAULT 0,PRIMARY KEY(workspace_id,day)
);
