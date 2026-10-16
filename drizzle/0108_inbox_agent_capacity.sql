ALTER TABLE inbox_agent_availability ADD COLUMN max_open_conversations integer;
--> statement-breakpoint
ALTER TABLE inbox_agent_availability ADD CONSTRAINT inbox_agent_capacity_valid CHECK (max_open_conversations IS NULL OR max_open_conversations BETWEEN 0 AND 1000);
--> statement-breakpoint
CREATE INDEX inbox_agent_open_workload ON inbox_conversations(channel_id,assignee_id) WHERE status='open' AND history_only=false AND merged_into_id IS NULL;
--> statement-breakpoint
ALTER TABLE inbox_conversations ADD COLUMN routing_attempt_at timestamptz(3);
--> statement-breakpoint
CREATE INDEX inbox_routing_pending ON inbox_conversations(channel_id,routing_attempt_at,created_at,id) WHERE status='open' AND assignee_id IS NULL AND team_id IS NOT NULL AND history_only=false AND merged_into_id IS NULL;
