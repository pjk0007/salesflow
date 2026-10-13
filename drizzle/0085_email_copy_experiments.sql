CREATE TABLE email_copy_experiments (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 rule_id integer NOT NULL, name text NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','evaluated','running','enrollment_closed','observing','decision_ready','closed','paused','data_check','insufficient_sample','invalidated')),
 config jsonb NOT NULL, config_fingerprint varchar(64) NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, enrollment_closed_at timestamptz, closed_at timestamptz,
 pending_mode text NOT NULL DEFAULT 'continue' CHECK(pending_mode IN('continue','hold')), paused_from text,
 invalidation_reason text, adopted_policy_id integer REFERENCES ai_copy_policy_versions(id), adopted_by uuid REFERENCES users(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX email_copy_active_rule_idx ON email_copy_experiments(org_id,workspace_id,rule_id)
 WHERE state IN('running','enrollment_closed','observing','decision_ready','paused','data_check','insufficient_sample');
--> statement-breakpoint
CREATE TABLE email_copy_experiment_contacts (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, normalized_email text NOT NULL,
 company_key text, company_verified boolean NOT NULL DEFAULT false, verification_note text NOT NULL DEFAULT '',
 tier text NOT NULL DEFAULT 'unclassified', verified_by uuid REFERENCES users(id), verified_at timestamptz,
 UNIQUE(org_id,workspace_id,normalized_email), CHECK(NOT company_verified OR company_key IS NOT NULL AND length(verification_note)>=10 AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE email_copy_assignments (
 id serial PRIMARY KEY, experiment_id integer NOT NULL REFERENCES email_copy_experiments(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 normalized_email text NOT NULL, customer_key varchar(64) NOT NULL, arm text NOT NULL CHECK(arm IN('A','B')),
 cohort text NOT NULL CHECK(cohort IN('primary','exploratory')), company_key text, record_id integer NOT NULL,
 initial_scheduled_at timestamptz NOT NULL, planned_sender_id integer, actual_sender_id integer,
 stratum varchar(64) NOT NULL, tier text NOT NULL, assigned_at timestamptz NOT NULL DEFAULT now(),
 generation_job_id integer REFERENCES ai_copy_generation_jobs(id) ON DELETE SET NULL, send_log_id integer REFERENCES email_send_logs(id) ON DELETE SET NULL, actual_sent_at timestamptz,
 UNIQUE(org_id,workspace_id,experiment_id,normalized_email), CHECK(cohort<>'primary' OR company_key IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX email_copy_company_representative_idx ON email_copy_assignments(experiment_id,company_key) WHERE cohort='primary';
--> statement-breakpoint
CREATE INDEX email_copy_customer_experiment_idx ON email_copy_assignments(org_id,workspace_id,normalized_email,experiment_id);
--> statement-breakpoint
CREATE TABLE email_copy_outcome_revisions (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 assignment_id integer NOT NULL REFERENCES email_copy_assignments(id) ON DELETE CASCADE,
 source_key text NOT NULL, revision integer NOT NULL, event_type text NOT NULL CHECK(event_type IN('human_reply','meeting','unsubscribe','external_contact')),
 intent text CHECK(intent IN('interested','neutral','rejected','unknown')), event_at timestamptz NOT NULL,
 email_reply_id integer REFERENCES email_replies(id) ON DELETE SET NULL, evidence text NOT NULL, active boolean NOT NULL DEFAULT true,
 recorded_by uuid NOT NULL REFERENCES users(id), recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(assignment_id,source_key,revision), CHECK(event_type<>'human_reply' OR intent IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX email_copy_outcome_history_idx ON email_copy_outcome_revisions(assignment_id,source_key,recorded_at DESC);
--> statement-breakpoint
CREATE TABLE email_copy_experiment_events (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 experiment_id integer NOT NULL REFERENCES email_copy_experiments(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES users(id), action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE ai_copy_generation_jobs ADD CONSTRAINT ai_copy_job_assignment_fk FOREIGN KEY(assignment_id) REFERENCES email_copy_assignments(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE FUNCTION email_copy_immutable_experiment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.config IS DISTINCT FROM OLD.config OR NEW.config_fingerprint IS DISTINCT FROM OLD.config_fingerprint
 OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id THEN
   RAISE EXCEPTION '실험 조건 변경은 새 실험으로 만들어야 합니다';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER email_copy_experiment_immutable BEFORE UPDATE ON email_copy_experiments FOR EACH ROW EXECUTE FUNCTION email_copy_immutable_experiment();
--> statement-breakpoint
CREATE FUNCTION email_copy_immutable_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND NEW.email_reply_id IS NULL
 AND (to_jsonb(NEW)-'email_reply_id')=(to_jsonb(OLD)-'email_reply_id') THEN RETURN NEW; END IF;
 RAISE EXCEPTION '성과 기록 수정은 새 이력으로 추가해야 합니다';
END $$;
--> statement-breakpoint
CREATE TRIGGER email_copy_outcome_immutable BEFORE UPDATE OR DELETE ON email_copy_outcome_revisions FOR EACH ROW EXECUTE FUNCTION email_copy_immutable_outcome();
--> statement-breakpoint
CREATE FUNCTION email_copy_rule_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE email_copy_experiments SET state='invalidated',pending_mode='hold',invalidation_reason='연결된 발송 규칙 삭제'
 WHERE org_id=OLD.org_id AND rule_id=OLD.id AND state NOT IN('closed','invalidated');
 UPDATE ai_copy_generation_jobs j SET state='held',reason='연결된 발송 규칙 삭제',lease_token=NULL,lease_until=NULL,updated_at=now()
 FROM email_copy_assignments a,email_copy_experiments e
 WHERE j.assignment_id=a.id AND a.experiment_id=e.id AND e.org_id=OLD.org_id AND e.rule_id=OLD.id AND e.state='invalidated' AND j.state<>'cancelled'
 AND NOT EXISTS(SELECT 1 FROM email_send_logs l WHERE l.id=j.send_log_id AND (l.status IN('pending','sent','delivered','uncertain') OR l.status='failed' AND l.request_id IS NOT NULL AND (l.nhn_status_code IS NOT NULL OR l.delivery_fail_source IS NOT NULL)));
 DELETE FROM ai_copy_bindings WHERE org_id=OLD.org_id AND purpose='initial_email' AND rule_id=OLD.id;
 INSERT INTO email_copy_experiment_events(org_id,experiment_id,action,detail)
 SELECT org_id,id,'rule_deleted','{}'::jsonb FROM email_copy_experiments WHERE org_id=OLD.org_id AND rule_id=OLD.id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER email_copy_rule_deleted BEFORE DELETE ON email_auto_personalized_links FOR EACH ROW EXECUTE FUNCTION email_copy_rule_deleted();
