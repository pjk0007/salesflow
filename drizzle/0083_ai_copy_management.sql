CREATE TABLE ai_copy_knowledge_versions (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','evaluating','evaluated','approved','retired','blocked')),
 snapshot jsonb NOT NULL, fingerprint varchar(64) NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id),
 approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), evaluation_run_id integer
);
--> statement-breakpoint
CREATE TABLE ai_copy_policy_versions (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, purpose text NOT NULL CHECK (purpose IN ('initial_email','visit_ack')),
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','evaluating','evaluated','approved','retired','blocked')),
 snapshot jsonb NOT NULL, fingerprint varchar(64) NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id),
 approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), evaluation_run_id integer
);
--> statement-breakpoint
CREATE TABLE ai_copy_bindings (
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK (purpose IN ('initial_email','visit_ack')), rule_id integer NOT NULL DEFAULT 0,
 policy_version_id integer NOT NULL REFERENCES ai_copy_policy_versions(id),
 knowledge_version_id integer NOT NULL REFERENCES ai_copy_knowledge_versions(id),
 changed_by uuid NOT NULL REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (org_id,workspace_id,purpose,rule_id)
);
--> statement-breakpoint
CREATE TABLE ai_copy_price_versions (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 provider text NOT NULL, model text NOT NULL, effective_at timestamptz NOT NULL,
 input_per_million numeric NOT NULL CHECK (input_per_million>=0), output_per_million numeric NOT NULL CHECK (output_per_million>=0),
 currency text NOT NULL CHECK (currency IN ('USD','KRW')), fx_to_krw numeric CHECK(fx_to_krw>0), fx_date date,
 source_url text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,provider,model,effective_at)
);
--> statement-breakpoint
CREATE TABLE ai_copy_generation_jobs (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK (purpose IN ('initial_email','visit_ack')), idempotency_key text NOT NULL,
 policy_version_id integer REFERENCES ai_copy_policy_versions(id), knowledge_version_id integer REFERENCES ai_copy_knowledge_versions(id),
 assignment_id integer, policy_snapshot jsonb NOT NULL, knowledge_snapshot jsonb, context jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','generating','ready','retry','held','cancelled')),
 output jsonb, attempts integer NOT NULL DEFAULT 0, validation_failures integer NOT NULL DEFAULT 0,
 eligible_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, retry_at timestamptz, lease_until timestamptz, lease_token uuid,
 reason text, send_log_id integer REFERENCES email_send_logs(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX ai_copy_jobs_pick_idx ON ai_copy_generation_jobs(state,retry_at,eligible_at);
--> statement-breakpoint
CREATE INDEX ai_copy_jobs_scope_idx ON ai_copy_generation_jobs(org_id,workspace_id,created_at DESC);
--> statement-breakpoint
CREATE TABLE ai_copy_generation_attempts (
 id serial PRIMARY KEY, job_id integer NOT NULL REFERENCES ai_copy_generation_jobs(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, attempt_number integer NOT NULL,
 lease_token uuid NOT NULL, provider text NOT NULL, model text NOT NULL,
 started_at timestamptz NOT NULL, finished_at timestamptz, duration_ms integer,
 result text NOT NULL DEFAULT 'running' CHECK(result IN ('running','valid','validation_failed','provider_failed','timeout','late')),
 reason text, raw_output text, output_fingerprint varchar(64),
 prompt_tokens integer, completion_tokens integer, usage_known boolean NOT NULL DEFAULT false,
 price_version_id integer REFERENCES ai_copy_price_versions(id), cost numeric, currency text, cost_krw numeric,
 late_usage_known boolean NOT NULL DEFAULT false, usage_logged boolean NOT NULL DEFAULT false,
 UNIQUE(job_id,attempt_number)
);
--> statement-breakpoint
CREATE TABLE ai_copy_evaluation_runs (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('initial_email','visit_ack')), dataset_version text NOT NULL,
 pairs jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','review','passed','failed','cancelled')),
 report jsonb, performance_evidence jsonb, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
--> statement-breakpoint
CREATE TABLE ai_copy_evaluation_cases (
 id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES ai_copy_evaluation_runs(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id), policy_version_id integer NOT NULL REFERENCES ai_copy_policy_versions(id),
 case_key text NOT NULL, repetition integer NOT NULL, blind_label varchar(64) NOT NULL,
 review_required boolean NOT NULL, job_id integer REFERENCES ai_copy_generation_jobs(id),
 UNIQUE(run_id,workspace_id,policy_version_id,case_key,repetition), UNIQUE(run_id,blind_label)
);
--> statement-breakpoint
CREATE TABLE ai_copy_human_reviews (
 id serial PRIMARY KEY, case_id integer NOT NULL REFERENCES ai_copy_evaluation_cases(id) ON DELETE CASCADE,
 reviewer_id uuid NOT NULL REFERENCES users(id), naturalness integer NOT NULL CHECK(naturalness BETWEEN 1 AND 5),
 factuality integer NOT NULL CHECK(factuality BETWEEN 1 AND 5), purpose_fit integer NOT NULL CHECK(purpose_fit BETWEEN 1 AND 5),
 critical_error boolean NOT NULL, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_id,reviewer_id)
);
--> statement-breakpoint
CREATE TABLE ai_copy_review_resolutions (
 case_id integer PRIMARY KEY REFERENCES ai_copy_evaluation_cases(id) ON DELETE CASCADE,
 resolved_by uuid NOT NULL REFERENCES users(id), naturalness integer NOT NULL CHECK(naturalness BETWEEN 1 AND 5),
 factuality integer NOT NULL CHECK(factuality BETWEEN 1 AND 5), purpose_fit integer NOT NULL CHECK(purpose_fit BETWEEN 1 AND 5),
 critical_error boolean NOT NULL, reason text NOT NULL CHECK(length(reason)>=10), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION ai_copy_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
 OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
 OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION '버전 내용은 복제하여 수정해야 합니다';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ai_copy_policy_immutable BEFORE UPDATE ON ai_copy_policy_versions FOR EACH ROW EXECUTE FUNCTION ai_copy_immutable_version();
--> statement-breakpoint
CREATE TRIGGER ai_copy_knowledge_immutable BEFORE UPDATE ON ai_copy_knowledge_versions FOR EACH ROW EXECUTE FUNCTION ai_copy_immutable_version();
