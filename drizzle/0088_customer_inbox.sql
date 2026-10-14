CREATE TABLE inbox_channels (
 id serial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 public_key varchar(80) NOT NULL UNIQUE, name varchar(100) NOT NULL,
 greeting text NOT NULL DEFAULT '반갑습니다. 무엇을 도와드릴까요?', color varchar(7) NOT NULL DEFAULT '#635BFF',
 allowed_origins jsonb NOT NULL DEFAULT '[]', enabled boolean NOT NULL DEFAULT false, created_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT inbox_channel_workspace UNIQUE(workspace_id)
);
--> statement-breakpoint
CREATE TABLE inbox_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, token_hash varchar(64) NOT NULL,
 name varchar(100) NOT NULL, email varchar(254), page_url text, status varchar(16) NOT NULL DEFAULT 'open',
 assignee_id uuid REFERENCES users(id) ON DELETE SET NULL, record_id integer REFERENCES records(id) ON DELETE SET NULL,
 tags jsonb NOT NULL DEFAULT '[]', priority boolean NOT NULL DEFAULT false, preview text NOT NULL DEFAULT '',
 last_message_at timestamptz(3) NOT NULL DEFAULT now(), customer_seq integer NOT NULL DEFAULT 0, created_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT inbox_status_valid CHECK(status IN ('open','snoozed','closed')), CONSTRAINT inbox_session_unique UNIQUE(channel_id,token_hash)
);
--> statement-breakpoint
CREATE INDEX inbox_org_recent ON inbox_conversations(org_id,last_message_at);
CREATE INDEX inbox_record ON inbox_conversations(record_id);
--> statement-breakpoint
CREATE TABLE inbox_messages (
 id serial PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
 client_id uuid NOT NULL, kind varchar(16) NOT NULL, body text NOT NULL, author_id uuid REFERENCES users(id) ON DELETE SET NULL,
 author_name varchar(100) NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT inbox_message_kind CHECK(kind IN ('customer','reply','note')), CONSTRAINT inbox_message_idempotency UNIQUE(conversation_id,client_id)
);
CREATE INDEX inbox_messages_order ON inbox_messages(conversation_id,id);
--> statement-breakpoint
CREATE TABLE inbox_reads (
 id serial PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, customer_seq integer NOT NULL DEFAULT 0,
 CONSTRAINT inbox_read_user UNIQUE(conversation_id,user_id)
);
