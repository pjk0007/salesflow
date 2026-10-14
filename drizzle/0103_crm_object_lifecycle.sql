ALTER TABLE crm_contacts ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0), ADD COLUMN archived_at timestamptz(3);
ALTER TABLE crm_companies ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0), ADD COLUMN archived_at timestamptz(3);
CREATE INDEX crm_contact_archive ON crm_contacts(org_id, workspace_id, archived_at, id);
CREATE INDEX crm_company_archive ON crm_companies(org_id, workspace_id, archived_at, id);
CREATE TABLE crm_object_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id),
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 resource varchar(20) NOT NULL CHECK (resource IN ('contacts','companies')), object_id uuid NOT NULL,
 version integer NOT NULL CHECK (version > 0), action varchar(20) NOT NULL CHECK (action IN ('created','updated','archived','restored')),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL, actor_name varchar(100) NOT NULL,
 source varchar(20) NOT NULL CHECK (source IN ('staff','api','workflow','import','email','system')),
 changes jsonb NOT NULL, reason varchar(500) NOT NULL DEFAULT '', created_at timestamptz(3) NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,resource,object_id,version)
);
CREATE INDEX crm_object_audit_page ON crm_object_audit(org_id,workspace_id,resource,object_id,created_at,id);
ALTER TABLE customer_workflow_runs ADD COLUMN subject_contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL,
 ADD COLUMN subject_company_id uuid REFERENCES crm_companies(id) ON DELETE SET NULL;
CREATE INDEX customer_workflow_contact ON customer_workflow_runs(workspace_id,subject_contact_id,state);
CREATE INDEX customer_workflow_company ON customer_workflow_runs(workspace_id,subject_company_id,state);
-- Resolve existing run subjects from validated source IDs, constrained to the run's organization/business.
WITH ids AS (
 SELECT id,org_id,workspace_id,
  coalesce(CASE WHEN event_snapshot #>> '{data,contactId}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,contactId}')::uuid END,CASE WHEN event_snapshot #>> '{data,contact,id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,contact,id}')::uuid END,CASE WHEN event_snapshot #>> '{data,event,contactId}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,event,contactId}')::uuid END) cid,
  coalesce(CASE WHEN event_snapshot #>> '{data,companyId}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,companyId}')::uuid END,CASE WHEN event_snapshot #>> '{data,company,id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,company,id}')::uuid END) coid,
  coalesce(CASE WHEN event_snapshot #>> '{data,deal,id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,deal,id}')::uuid END,CASE WHEN event_snapshot #>> '{data,dealId}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,dealId}')::uuid END) did,
  coalesce(CASE WHEN event_snapshot #>> '{data,task,id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,task,id}')::uuid END,CASE WHEN event_snapshot #>> '{data,taskId}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,taskId}')::uuid END) tid,
  coalesce(CASE WHEN event_snapshot #>> '{data,conversationId}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,conversationId}')::uuid END,CASE WHEN event_snapshot #>> '{data,conversation,id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (event_snapshot #>> '{data,conversation,id}')::uuid END) vid
 FROM customer_workflow_runs
), resolved AS (
 SELECT i.*,coalesce(i.cid,d.contact_id,t.contact_id,v.contact_id) contact_id,coalesce(i.coid,d.company_id,t.company_id) company_id
 FROM ids i
 LEFT JOIN crm_deals d ON d.id=i.did AND d.org_id=i.org_id AND d.workspace_id=i.workspace_id
 LEFT JOIN crm_tasks t ON t.id=i.tid AND t.org_id=i.org_id AND t.workspace_id=i.workspace_id
 LEFT JOIN inbox_conversations v ON v.id=i.vid AND v.org_id=i.org_id AND EXISTS(SELECT 1 FROM inbox_channels ch WHERE ch.id=v.channel_id AND ch.org_id=i.org_id AND ch.workspace_id=i.workspace_id)
), subjects AS (
 SELECT r.id,c.id contact_id,co.id company_id FROM resolved r
 LEFT JOIN crm_contacts c ON c.id=r.contact_id AND c.org_id=r.org_id AND c.workspace_id=r.workspace_id
 LEFT JOIN crm_companies co ON co.id=coalesce(r.company_id,(SELECT CASE WHEN count(*)=1 THEN min(link.company_id::text)::uuid END FROM crm_contact_companies link WHERE link.contact_id=c.id)) AND co.org_id=r.org_id AND co.workspace_id=r.workspace_id
)
UPDATE customer_workflow_runs run SET subject_contact_id=s.contact_id,subject_company_id=s.company_id FROM subjects s WHERE run.id=s.id;
