ALTER TABLE inbox_conversations ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE inbox_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
 draft_conversation_id uuid REFERENCES inbox_conversations(id) ON DELETE CASCADE,
 message_id integer REFERENCES inbox_messages(id) ON DELETE CASCADE,
 owner_key varchar(64) NOT NULL, client_id uuid NOT NULL, kind varchar(16) NOT NULL,
 file_name varchar(180) NOT NULL, content_type varchar(120) NOT NULL, size integer NOT NULL, sha256 varchar(64) NOT NULL,
 expires_at timestamptz(3), cancelled_at timestamptz(3), created_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT inbox_attachment_client UNIQUE(channel_id,owner_key,client_id),
 CONSTRAINT inbox_attachment_kind CHECK(kind IN ('customer','reply','note')),
 CONSTRAINT inbox_attachment_size CHECK(size > 0 AND size <= 20971520)
);
CREATE INDEX inbox_attachment_message ON inbox_attachments(message_id);
CREATE INDEX inbox_attachment_expiry ON inbox_attachments(channel_id,expires_at) WHERE message_id IS NULL AND cancelled_at IS NULL;
--> statement-breakpoint
CREATE TABLE inbox_attachment_blobs (
 attachment_id uuid PRIMARY KEY REFERENCES inbox_attachments(id) ON DELETE CASCADE,
 bytes bytea NOT NULL
);
--> statement-breakpoint
CREATE TABLE inbox_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
 conversation_id uuid REFERENCES inbox_conversations(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL, actor_name varchar(100) NOT NULL,
 action varchar(60) NOT NULL, changes jsonb NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX inbox_audit_conversation ON inbox_audit_events(conversation_id,created_at,id);
