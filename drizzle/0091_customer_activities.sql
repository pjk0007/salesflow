CREATE TABLE crm_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL, company_id uuid REFERENCES crm_companies(id) ON DELETE SET NULL,
 source varchar(30) NOT NULL, entity_id varchar(100) NOT NULL, event_key varchar(200) NOT NULL,
 action varchar(100) NOT NULL, summary varchar(200) NOT NULL, actor_name varchar(100), metadata jsonb NOT NULL DEFAULT '{}',
 occurred_at timestamptz(3) NOT NULL DEFAULT now(), created_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT crm_activity_event UNIQUE(workspace_id,event_key)
);
CREATE INDEX crm_activity_contact ON crm_activities(org_id,workspace_id,contact_id,occurred_at,id);
--> statement-breakpoint
-- 증거가 남아 있는 기존 이벤트·딜 감사·공개 상담 메시지만 복원한다.
INSERT INTO crm_activities(org_id,workspace_id,contact_id,source,entity_id,event_key,action,summary,metadata,occurred_at)
 SELECT org_id,workspace_id,contact_id,'event',id::text,'event:'||id::text,name,name,properties,occurred_at FROM crm_customer_events
 ON CONFLICT DO NOTHING;
INSERT INTO crm_activities(org_id,workspace_id,contact_id,source,entity_id,event_key,action,summary,actor_name,metadata,occurred_at)
 SELECT d.org_id,d.workspace_id,c.id,'deal',d.id::text,'deal:'||d.id::text||':v'||coalesce(h.change->'after'->>'version',h.id::text),
 h.change->>'action',coalesce(h.change->'after'->>'title',d.title),h.actor_name,jsonb_build_object('stage',h.change->'stage','backfilled',true),h.created_at
 FROM crm_deal_history h JOIN crm_deals d ON d.id=h.deal_id
 LEFT JOIN crm_contacts c ON c.id=CASE WHEN h.change ? 'after' THEN (h.change->'after'->>'contactId')::uuid ELSE d.contact_id END AND c.org_id=d.org_id AND c.workspace_id=d.workspace_id
 ON CONFLICT DO NOTHING;
INSERT INTO crm_activities(org_id,workspace_id,contact_id,source,entity_id,event_key,action,summary,actor_name,metadata,occurred_at)
 SELECT v.org_id,ch.workspace_id,v.contact_id,'conversation',v.id::text,'message:'||m.id::text,m.kind,left(m.body,200),m.author_name,jsonb_build_object('conversationId',v.id,'messageId',m.id),m.created_at
 FROM inbox_messages m JOIN inbox_conversations v ON v.id=m.conversation_id JOIN inbox_channels ch ON ch.id=v.channel_id WHERE m.kind<>'note' AND v.contact_id IS NOT NULL
 ON CONFLICT DO NOTHING;
-- 과거 업무의 변경 이력은 없으므로 현재 상태의 스냅샷으로만 표시한다.
INSERT INTO crm_activities(org_id,workspace_id,contact_id,company_id,source,entity_id,event_key,action,summary,metadata,occurred_at)
 SELECT org_id,workspace_id,contact_id,company_id,'task',id::text,'task:'||id::text||':v'||version::text,'snapshot',title,jsonb_build_object('status',status,'backfilled',true),updated_at FROM crm_tasks
 ON CONFLICT DO NOTHING;
