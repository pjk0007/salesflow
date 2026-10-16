ALTER TABLE inbox_conversations ADD COLUMN is_current boolean NOT NULL DEFAULT true;
ALTER TABLE inbox_conversations ADD COLUMN customer_create_key uuid;
DROP INDEX inbox_contact_unique;
CREATE UNIQUE INDEX inbox_contact_unique ON inbox_conversations(channel_id,contact_id)
WHERE history_only=false AND medium='web' AND is_current=true AND merged_into_id IS NULL;
CREATE UNIQUE INDEX inbox_customer_create_once ON inbox_conversations(channel_id,contact_id,customer_create_key);
CREATE INDEX inbox_customer_history ON inbox_conversations(channel_id,contact_id,last_message_at,id);
--> statement-breakpoint
CREATE TABLE inbox_customer_reads (
 conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
 last_message_id integer NOT NULL DEFAULT 0 CHECK(last_message_id>=0),
 merged_unread_ids integer[] NOT NULL DEFAULT '{}'::integer[],
 read_revision integer NOT NULL DEFAULT 0 CHECK(read_revision>=0),
 updated_at timestamptz(3) NOT NULL DEFAULT now(),
 PRIMARY KEY(conversation_id,contact_id)
);
