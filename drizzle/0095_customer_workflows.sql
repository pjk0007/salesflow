ALTER TABLE platform_events ADD COLUMN workflow_run_id uuid;
--> statement-breakpoint
CREATE TABLE customer_workflows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name varchar(100) NOT NULL,description varchar(1000) NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,generation integer NOT NULL DEFAULT 1,
 enabled boolean NOT NULL DEFAULT false,active_revision_id uuid,created_by uuid REFERENCES users(id) ON DELETE SET NULL,updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX customer_workflow_scope ON customer_workflows(org_id,workspace_id,id);
CREATE TABLE customer_workflow_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workflow_id uuid NOT NULL REFERENCES customer_workflows(id) ON DELETE CASCADE,version integer NOT NULL,
 name varchar(100) NOT NULL,description varchar(1000) NOT NULL,definition jsonb NOT NULL,fingerprint varchar(64) NOT NULL,published_by uuid REFERENCES users(id) ON DELETE SET NULL,published_at timestamptz(3),created_at timestamptz(3) NOT NULL DEFAULT now(),UNIQUE(workflow_id,version)
);
ALTER TABLE customer_workflows ADD CONSTRAINT customer_workflow_active FOREIGN KEY(active_revision_id) REFERENCES customer_workflow_revisions(id);
CREATE TABLE customer_workflow_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workflow_id uuid NOT NULL REFERENCES customer_workflows(id) ON DELETE CASCADE,revision_id uuid NOT NULL REFERENCES customer_workflow_revisions(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES platform_events(id) ON DELETE CASCADE,fingerprint varchar(64) NOT NULL,report jsonb NOT NULL,passed boolean NOT NULL,created_by uuid REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE customer_workflow_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 workflow_id uuid NOT NULL REFERENCES customer_workflows(id) ON DELETE CASCADE,revision_id uuid NOT NULL REFERENCES customer_workflow_revisions(id),generation integer NOT NULL,
 event_id uuid NOT NULL REFERENCES platform_events(id),event_snapshot jsonb NOT NULL,cursor integer NOT NULL DEFAULT 0,state varchar(20) NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','waiting','retry','succeeded','skipped','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,eligible_at timestamptz(3) NOT NULL DEFAULT now(),lease_id uuid,lease_until timestamptz(3),reason varchar(500),created_at timestamptz(3) NOT NULL DEFAULT now(),updated_at timestamptz(3) NOT NULL DEFAULT now(),UNIQUE(workflow_id,event_id)
);
CREATE INDEX customer_workflow_due ON customer_workflow_runs(state,eligible_at,lease_until);
CREATE INDEX customer_workflow_runs_page ON customer_workflow_runs(workflow_id,created_at,id);
CREATE TABLE customer_workflow_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES customer_workflow_runs(id) ON DELETE CASCADE,step_id uuid NOT NULL,position integer NOT NULL,
 kind varchar(30) NOT NULL,state varchar(20) NOT NULL,detail jsonb NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT now(),UNIQUE(run_id,position)
);
CREATE TABLE customer_workflow_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workflow_id uuid NOT NULL REFERENCES customer_workflows(id) ON DELETE CASCADE,actor_name varchar(100) NOT NULL,action varchar(30) NOT NULL,detail jsonb NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT now()
);
