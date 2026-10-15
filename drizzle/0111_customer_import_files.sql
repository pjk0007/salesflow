ALTER TABLE inbox_attachments ADD COLUMN import_metadata jsonb;
--> statement-breakpoint
CREATE TABLE customer_import_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES customer_imports(id) ON DELETE CASCADE,
 message_id integer NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
 source_key varchar(64) NOT NULL, manifest varchar(64) NOT NULL,
 file_name varchar(180) NOT NULL, expected_size integer, expected_sha256 varchar(64), locator jsonb NOT NULL,
 source_url text, state varchar(20) NOT NULL DEFAULT 'pending', active boolean NOT NULL DEFAULT true, metadata_valid boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, attempts integer NOT NULL DEFAULT 0,
 lease_token uuid, lease_until timestamptz(3), error varchar(500),
 attachment_id uuid REFERENCES inbox_attachments(id) ON DELETE SET NULL,
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT customer_import_file_state CHECK (state IN ('pending','fetching','ready','failed','needs_source')),
 CONSTRAINT customer_import_file_version CHECK (version>0 AND attempts>=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_import_file_manifest ON customer_import_files(message_id,source_key,manifest);
--> statement-breakpoint
CREATE INDEX customer_import_file_job ON customer_import_files(job_id,id);
