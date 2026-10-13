ALTER TABLE ai_copy_generation_jobs ADD COLUMN origin text NOT NULL DEFAULT 'operational' CHECK(origin IN('operational','evaluation','benchmark','replacement'));
--> statement-breakpoint
UPDATE ai_copy_generation_jobs SET origin=CASE WHEN idempotency_key LIKE 'evaluation:%' THEN 'evaluation' WHEN idempotency_key LIKE 'benchmark:%' THEN 'benchmark' ELSE 'operational' END;
--> statement-breakpoint
ALTER TABLE ai_copy_generation_jobs ADD COLUMN superseded_by_id integer REFERENCES ai_copy_generation_jobs(id);
--> statement-breakpoint
ALTER TABLE ai_copy_generation_jobs ADD COLUMN requested_by uuid REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ai_copy_generation_jobs ADD COLUMN approved_context jsonb;
--> statement-breakpoint
ALTER TABLE ai_copy_generation_attempts ADD COLUMN charged_prompt_tokens integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE ai_copy_generation_attempts ADD COLUMN charged_completion_tokens integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE ai_copy_generation_attempts ADD COLUMN usage_log_id integer REFERENCES ai_usage_logs(id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE ai_copy_generation_attempts SET charged_prompt_tokens=COALESCE(prompt_tokens,0),charged_completion_tokens=COALESCE(completion_tokens,0) WHERE usage_logged;
--> statement-breakpoint
ALTER TABLE email_copy_assignments ADD COLUMN planned_sender_email text;
--> statement-breakpoint
ALTER TABLE email_copy_assignments ADD COLUMN actual_sender_email text;
--> statement-breakpoint
ALTER TABLE ai_copy_policy_versions ADD COLUMN last_changed_by uuid REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ai_copy_policy_versions ADD COLUMN last_changed_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE ai_copy_policy_versions ADD COLUMN state_reason text;
--> statement-breakpoint
ALTER TABLE ai_copy_knowledge_versions ADD COLUMN last_changed_by uuid REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ai_copy_knowledge_versions ADD COLUMN last_changed_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE ai_copy_knowledge_versions ADD COLUMN state_reason text;
--> statement-breakpoint
CREATE TABLE ai_copy_binding_events (
 id serial PRIMARY KEY,org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,purpose text NOT NULL,rule_id integer NOT NULL,
 previous_policy_id integer,previous_knowledge_id integer,policy_version_id integer,knowledge_version_id integer,
 changed_by uuid REFERENCES users(id) ON DELETE SET NULL,changed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX ai_copy_binding_events_org_idx ON ai_copy_binding_events(org_id,id DESC);
--> statement-breakpoint
CREATE FUNCTION ai_copy_record_binding_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.policy_version_id=OLD.policy_version_id AND NEW.knowledge_version_id=OLD.knowledge_version_id THEN RETURN NEW; END IF;
 INSERT INTO ai_copy_binding_events(org_id,workspace_id,purpose,rule_id,previous_policy_id,previous_knowledge_id,policy_version_id,knowledge_version_id,changed_by)
 VALUES(NEW.org_id,NEW.workspace_id,NEW.purpose,NEW.rule_id,CASE WHEN TG_OP='UPDATE' THEN OLD.policy_version_id END,CASE WHEN TG_OP='UPDATE' THEN OLD.knowledge_version_id END,NEW.policy_version_id,NEW.knowledge_version_id,NEW.changed_by);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ai_copy_record_binding_change AFTER INSERT OR UPDATE ON ai_copy_bindings FOR EACH ROW EXECUTE FUNCTION ai_copy_record_binding_change();
