CREATE TABLE crm_pipelines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, external_id varchar(200) NOT NULL,
 name varchar(100) NOT NULL, stages jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT crm_pipeline_external UNIQUE(workspace_id,external_id)
);
--> statement-breakpoint
CREATE TABLE crm_deals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, external_id varchar(200) NOT NULL,
 title varchar(200) NOT NULL, pipeline_id uuid NOT NULL REFERENCES crm_pipelines(id), stage_id uuid NOT NULL,
 contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL, company_id uuid REFERENCES crm_companies(id) ON DELETE SET NULL,
 owner_id uuid REFERENCES users(id) ON DELETE SET NULL, amount numeric(18,2) NOT NULL DEFAULT 0, currency varchar(3) NOT NULL DEFAULT 'KRW',
 expected_close_date date, notes text NOT NULL DEFAULT '', archived_at timestamptz(3), version integer NOT NULL DEFAULT 1,
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT crm_deal_external UNIQUE(workspace_id,external_id), CONSTRAINT crm_deal_amount CHECK(amount >= 0)
);
CREATE INDEX crm_deal_pipeline ON crm_deals(org_id,workspace_id,pipeline_id,stage_id);
--> statement-breakpoint
CREATE TABLE crm_deal_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deal_id uuid NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL, actor_name varchar(100) NOT NULL,
 change jsonb NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX crm_deal_history_order ON crm_deal_history(deal_id,created_at,id);
--> statement-breakpoint
CREATE TABLE crm_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, external_id varchar(200) NOT NULL,
 title varchar(200) NOT NULL, body text NOT NULL DEFAULT '', due_at timestamptz(3), owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
 contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL, company_id uuid REFERENCES crm_companies(id) ON DELETE SET NULL,
 deal_id uuid REFERENCES crm_deals(id) ON DELETE SET NULL, status varchar(16) NOT NULL DEFAULT 'open', completed_at timestamptz(3),
 version integer NOT NULL DEFAULT 1, created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT crm_task_external UNIQUE(workspace_id,external_id), CONSTRAINT crm_task_status CHECK(status IN ('open','done','cancelled'))
);
CREATE INDEX crm_task_due ON crm_tasks(org_id,workspace_id,status,due_at);
