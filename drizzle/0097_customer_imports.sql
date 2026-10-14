ALTER TABLE inbox_conversations ADD COLUMN history_only boolean NOT NULL DEFAULT false;
ALTER TABLE inbox_conversations ADD COLUMN import_metadata jsonb;
ALTER TABLE inbox_messages ADD COLUMN import_metadata jsonb;
DROP INDEX inbox_contact_unique;
CREATE UNIQUE INDEX inbox_contact_unique ON inbox_conversations(channel_id,contact_id) WHERE history_only=false;
CREATE TABLE customer_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 source varchar(20) NOT NULL,namespace varchar(80) NOT NULL,state varchar(20) NOT NULL DEFAULT 'ready',version integer NOT NULL DEFAULT 1,cursor integer NOT NULL DEFAULT 0,
 input jsonb NOT NULL,plan jsonb NOT NULL,errors jsonb NOT NULL DEFAULT '[]',warnings jsonb NOT NULL DEFAULT '[]',fingerprint varchar(64) NOT NULL,reason text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz(3) NOT NULL DEFAULT now(),updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CHECK (state IN ('ready','running','paused','failed','completed','cancelled')),CHECK (cursor>=0)
);
CREATE INDEX customer_import_page ON customer_imports(org_id,workspace_id,created_at,id);
CREATE TABLE customer_import_objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 source varchar(20) NOT NULL,namespace varchar(80) NOT NULL,kind varchar(20) NOT NULL,source_id varchar(200) NOT NULL,target_id varchar(200) NOT NULL,
 source_fingerprint varchar(64) NOT NULL,target_fingerprint varchar(64) NOT NULL,owned boolean NOT NULL,job_id uuid NOT NULL REFERENCES customer_imports(id),updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_import_source ON customer_import_objects(workspace_id,source,namespace,kind,source_id);
CREATE TABLE customer_import_results (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES customer_imports(id) ON DELETE CASCADE,position integer NOT NULL,operation varchar(20) NOT NULL,target_id varchar(200) NOT NULL,target_fingerprint varchar(64) NOT NULL,"before" jsonb,"after" jsonb,created_at timestamptz(3) NOT NULL DEFAULT now());
CREATE UNIQUE INDEX customer_import_result_once ON customer_import_results(job_id,position);
CREATE TABLE customer_import_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES customer_imports(id) ON DELETE CASCADE,actor_name varchar(100) NOT NULL,action varchar(30) NOT NULL,detail jsonb NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT now());
