ALTER TABLE inbox_conversations ADD COLUMN medium varchar(16) NOT NULL DEFAULT 'web';
--> statement-breakpoint
ALTER TABLE inbox_conversations ADD CONSTRAINT inbox_medium_valid CHECK (medium IN ('web','email'));
--> statement-breakpoint
DROP INDEX inbox_contact_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_contact_unique ON inbox_conversations(channel_id,contact_id) WHERE history_only=false AND medium='web';
--> statement-breakpoint
CREATE TABLE inbox_mailboxes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
 address varchar(254) NOT NULL, name varchar(100) NOT NULL, enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 created_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_mailbox_address ON inbox_mailboxes(org_id,address);
--> statement-breakpoint
CREATE TABLE inbox_email_threads (
 conversation_id uuid PRIMARY KEY REFERENCES inbox_conversations(id) ON DELETE CASCADE,
 mailbox_id uuid NOT NULL REFERENCES inbox_mailboxes(id), provider_thread_id varchar(200) NOT NULL,
 correspondent varchar(254) NOT NULL, subject varchar(500) NOT NULL, last_rfc_message_id varchar(998) NOT NULL,
 last_received_at timestamptz(3) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_email_thread_once ON inbox_email_threads(mailbox_id,provider_thread_id);
--> statement-breakpoint
CREATE TABLE inbox_email_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mailbox_id uuid NOT NULL REFERENCES inbox_mailboxes(id),
 provider_message_id varchar(200) NOT NULL, fingerprint varchar(64) NOT NULL, message_id integer REFERENCES inbox_messages(id),
 ignored_reason varchar(100), envelope jsonb NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_email_receipt_once ON inbox_email_receipts(mailbox_id,provider_message_id);
--> statement-breakpoint
CREATE TABLE inbox_email_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mailbox_id uuid NOT NULL REFERENCES inbox_mailboxes(id),
 message_id integer NOT NULL REFERENCES inbox_messages(id), mailbox_version integer NOT NULL,
 recipient varchar(254) NOT NULL, subject varchar(500) NOT NULL, provider_thread_id varchar(200) NOT NULL,
 rfc_message_id varchar(998) NOT NULL, in_reply_to varchar(998) NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','leased','sending','sent','failed','uncertain','cancelled')),
 lease_token uuid, lease_until timestamptz(3), attempts integer NOT NULL DEFAULT 0, error_code varchar(100),
 provider_message_id varchar(200), sent_at timestamptz(3), created_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_email_delivery_once ON inbox_email_deliveries(message_id);
--> statement-breakpoint
CREATE INDEX inbox_email_delivery_pending ON inbox_email_deliveries(mailbox_id,state,created_at);
