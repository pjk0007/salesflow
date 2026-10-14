CREATE TABLE ai_copy_automation_settings (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('initial_email','visit_ack')), rule_id integer NOT NULL DEFAULT 0,
 enabled boolean NOT NULL DEFAULT false, experiment_mode text NOT NULL DEFAULT 'auto' CHECK(experiment_mode IN ('auto','manual')),
 actor_id uuid NOT NULL REFERENCES users(id), next_run_at timestamptz NOT NULL DEFAULT now(),
 last_error text, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,workspace_id,purpose,rule_id)
);
--> statement-breakpoint
CREATE TABLE ai_copy_automation_cycles (
 id serial PRIMARY KEY, setting_id integer NOT NULL REFERENCES ai_copy_automation_settings(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, workspace_id integer NOT NULL,
 purpose text NOT NULL, rule_id integer NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 stage text NOT NULL DEFAULT 'candidate' CHECK(stage IN ('candidate','generating','reviewing','ready_for_experiment','experimenting','awaiting_application','applied','declined','blocked')),
 baseline_policy_id integer NOT NULL REFERENCES ai_copy_policy_versions(id), candidate_policy_id integer REFERENCES ai_copy_policy_versions(id),
 knowledge_version_id integer NOT NULL REFERENCES ai_copy_knowledge_versions(id),
 original_binding jsonb, rule_fingerprint text, cursor integer NOT NULL DEFAULT 0, company_cursor integer NOT NULL DEFAULT 0,
 report jsonb, reason text, experiment_id integer REFERENCES email_copy_experiments(id), experiment_owned boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), applied_by uuid REFERENCES users(id), applied_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_copy_automation_active_cycle_idx ON ai_copy_automation_cycles(setting_id)
 WHERE stage NOT IN ('applied','declined','blocked');
--> statement-breakpoint
CREATE TABLE ai_copy_automation_samples (
 cycle_id integer NOT NULL REFERENCES ai_copy_automation_cycles(id) ON DELETE CASCADE,
 sample_index integer NOT NULL, arm text NOT NULL CHECK(arm IN ('A','B')), scenario integer NOT NULL,
 repetition integer NOT NULL, job_id integer NOT NULL REFERENCES ai_copy_generation_jobs(id),
 PRIMARY KEY(cycle_id,sample_index)
);
--> statement-breakpoint
CREATE TABLE ai_copy_automation_calls (
 job_id integer PRIMARY KEY REFERENCES ai_copy_generation_jobs(id) ON DELETE CASCADE,
 cycle_id integer NOT NULL REFERENCES ai_copy_automation_cycles(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('candidate','review','reply')), result jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE ai_copy_policy_versions ADD COLUMN approval_method text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE ai_copy_knowledge_versions ADD COLUMN approval_method text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE email_copy_outcome_revisions ADD COLUMN source_method text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE email_copy_outcome_revisions ADD COLUMN confidence numeric;
