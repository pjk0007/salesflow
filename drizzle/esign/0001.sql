-- Explicitly installed against ESIGN_DATABASE_URL; never part of the app startup journal.
CREATE SCHEMA IF NOT EXISTS esign;
CREATE TABLE IF NOT EXISTS esign.documents (
    id uuid PRIMARY KEY, org_id uuid NOT NULL, workspace_id integer NOT NULL,
    version integer NOT NULL CHECK (version > 0), data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_documents_scope ON esign.documents (org_id, workspace_id, created_at DESC);
CREATE TABLE IF NOT EXISTS esign.envelopes (
    id uuid PRIMARY KEY, org_id uuid NOT NULL, workspace_id integer NOT NULL,
    version integer NOT NULL CHECK (version > 0), state text NOT NULL CHECK (state IN ('draft','pending','finalizing','completed','cancelled','rejected','expired')),
    expires_at timestamptz NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_envelopes_scope ON esign.envelopes (org_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS esign_envelopes_expiry ON esign.envelopes (expires_at,id) WHERE state IN ('draft','pending');
CREATE TABLE IF NOT EXISTS esign.recipients (
    id uuid PRIMARY KEY, envelope_id uuid NOT NULL REFERENCES esign.envelopes(id),
    token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'), data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS esign_recipients_envelope ON esign.recipients (envelope_id);
CREATE TABLE IF NOT EXISTS esign.events (
    id uuid PRIMARY KEY, envelope_id uuid NOT NULL REFERENCES esign.envelopes(id),
    data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_events_envelope ON esign.events (envelope_id, created_at);
CREATE TABLE IF NOT EXISTS esign.jobs (
    id uuid PRIMARY KEY, envelope_id uuid NOT NULL REFERENCES esign.envelopes(id),
    kind text NOT NULL CHECK (kind IN ('invitation','otp','finalize','completed')),
    state text NOT NULL CHECK (state IN ('blocked','pending','processing','accepted','failed','unknown','cancelled')),
    job_key text NOT NULL UNIQUE, available_at timestamptz NOT NULL, lease_until timestamptz,
    data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_jobs_due ON esign.jobs (available_at, id) WHERE state IN ('pending','processing');
CREATE INDEX IF NOT EXISTS esign_jobs_priority_due ON esign.jobs ((CASE WHEN kind='otp' THEN 0 WHEN kind='finalize' THEN 1 ELSE 2 END), available_at, id) WHERE state IN ('pending','processing');
CREATE INDEX IF NOT EXISTS esign_jobs_finalize_lease ON esign.jobs (lease_until) WHERE kind='finalize' AND state='processing';
CREATE INDEX IF NOT EXISTS esign_jobs_envelope ON esign.jobs (envelope_id);
