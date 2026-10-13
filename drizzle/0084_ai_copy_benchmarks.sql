CREATE TABLE ai_copy_benchmark_runs (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 evaluation_run_id integer NOT NULL REFERENCES ai_copy_evaluation_runs(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','completed','cancelled')),
 hardware jsonb NOT NULL, started_at timestamptz NOT NULL, completed_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_copy_one_benchmark_idx ON ai_copy_benchmark_runs(evaluation_run_id) WHERE state='running';
--> statement-breakpoint
CREATE TABLE ai_copy_benchmark_cases (
 id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES ai_copy_benchmark_runs(id) ON DELETE CASCADE,
 template_job_id integer NOT NULL REFERENCES ai_copy_generation_jobs(id),
 repetition integer NOT NULL CHECK(repetition BETWEEN 0 AND 2), ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 209),
 scheduled_at timestamptz NOT NULL, job_id integer REFERENCES ai_copy_generation_jobs(id),
 UNIQUE(run_id,repetition,ordinal)
);
--> statement-breakpoint
CREATE INDEX ai_copy_benchmark_due_idx ON ai_copy_benchmark_cases(run_id,scheduled_at);
