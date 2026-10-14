CREATE TABLE crm_companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, external_id varchar(200) NOT NULL,
 name varchar(200) NOT NULL, domain varchar(253), attributes jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT crm_company_external UNIQUE(workspace_id,external_id)
);
CREATE INDEX crm_company_scope ON crm_companies(org_id,workspace_id);
--> statement-breakpoint
CREATE TABLE crm_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, external_id varchar(200) NOT NULL,
 name varchar(100) NOT NULL, email varchar(254), phone varchar(40), record_id integer REFERENCES records(id) ON DELETE SET NULL,
 lifecycle_stage varchar(30) NOT NULL DEFAULT 'lead', is_internal boolean NOT NULL DEFAULT false, attributes jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT crm_contact_external UNIQUE(workspace_id,external_id),
 CONSTRAINT crm_contact_stage CHECK(lifecycle_stage IN ('lead','prospect','customer','inactive'))
);
CREATE INDEX crm_contact_scope ON crm_contacts(org_id,workspace_id);
CREATE INDEX crm_contact_record ON crm_contacts(record_id);
--> statement-breakpoint
CREATE TABLE crm_contact_companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
 CONSTRAINT crm_contact_company_pair UNIQUE(contact_id,company_id)
);
--> statement-breakpoint
CREATE TABLE crm_customer_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
 event_id uuid NOT NULL, name varchar(100) NOT NULL, source varchar(16) NOT NULL,
 properties jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz(3) NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT crm_event_idempotency UNIQUE(workspace_id,event_id), CONSTRAINT crm_event_source CHECK(source IN ('server','web'))
);
CREATE INDEX crm_event_contact ON crm_customer_events(contact_id,occurred_at);
--> statement-breakpoint
ALTER TABLE inbox_conversations ADD COLUMN contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX inbox_contact_unique ON inbox_conversations(channel_id,contact_id);
