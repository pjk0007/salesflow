CREATE TABLE platform_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigserial NOT NULL UNIQUE,org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,event_key varchar(200) NOT NULL,type varchar(80) NOT NULL,
 payload jsonb NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT now(),UNIQUE(workspace_id,event_key)
);
CREATE INDEX platform_event_scope ON platform_events(org_id,workspace_id,created_at,id);
--> statement-breakpoint
CREATE TABLE platform_webhooks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name varchar(100) NOT NULL,url varchar(2000) NOT NULL,
 event_types jsonb NOT NULL,enabled boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,generation integer NOT NULL DEFAULT 1,
 secret_cipher varchar(400) NOT NULL,secret_hint varchar(12) NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT now(),updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX platform_webhook_scope ON platform_webhooks(org_id,workspace_id);
--> statement-breakpoint
CREATE TABLE platform_webhook_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,endpoint_id uuid NOT NULL REFERENCES platform_webhooks(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES platform_events(id) ON DELETE CASCADE,endpoint_version integer NOT NULL,
 state varchar(20) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','retry','succeeded','dead','cancelled')),
 attempts integer NOT NULL DEFAULT 0,cycle_attempts integer NOT NULL DEFAULT 0,available_at timestamptz(3) NOT NULL DEFAULT now(),lease_id uuid,lease_until timestamptz(3),
 last_status integer,last_error varchar(300),delivered_at timestamptz(3),created_at timestamptz(3) NOT NULL DEFAULT now(),UNIQUE(endpoint_id,event_id)
);
CREATE INDEX platform_delivery_due ON platform_webhook_deliveries(state,available_at,lease_until);
CREATE INDEX platform_delivery_scope ON platform_webhook_deliveries(org_id,workspace_id,endpoint_id,created_at,id);
--> statement-breakpoint
CREATE TABLE platform_webhook_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),delivery_id uuid NOT NULL REFERENCES platform_webhook_deliveries(id) ON DELETE CASCADE,
 attempt integer NOT NULL,lease_id uuid NOT NULL,state varchar(20) NOT NULL CHECK(state IN ('sending','succeeded','failed','unknown')),
 status integer,error varchar(300),url varchar(2000) NOT NULL,started_at timestamptz(3) NOT NULL DEFAULT now(),finished_at timestamptz(3),UNIQUE(delivery_id,attempt)
);
CREATE TABLE platform_webhook_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),endpoint_id uuid NOT NULL REFERENCES platform_webhooks(id) ON DELETE CASCADE,
 actor_name varchar(100) NOT NULL,action varchar(80) NOT NULL,version integer NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT now()
);
