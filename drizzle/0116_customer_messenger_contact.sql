ALTER TABLE inbox_channels ADD COLUMN IF NOT EXISTS messenger_settings jsonb NOT NULL DEFAULT '{"enabled":false,"tagline":"","consultationUrl":"","emailNotifications":false}'::jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS customer_reply_contacts (
    conversation_id uuid PRIMARY KEY REFERENCES inbox_conversations(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL DEFAULT '', phone varchar(30) NOT NULL DEFAULT '', email varchar(254) NOT NULL DEFAULT '',
    notify_email boolean NOT NULL DEFAULT false, consent_at timestamptz(3), verified_at timestamptz(3),
    verification_hash varchar(64), verification_expires_at timestamptz(3), verification_sent_at timestamptz(3),
    verification_attempts integer NOT NULL DEFAULT 0, verification_sends integer NOT NULL DEFAULT 0,
    read_message_id integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1, updated_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_reply_contact_email ON customer_reply_contacts(email,verification_sent_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS customer_reply_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
    message_id integer NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE, contact_version integer NOT NULL,
    state varchar(20) NOT NULL DEFAULT 'pending', due_at timestamptz(3) NOT NULL, claimed_at timestamptz(3), provider_id varchar(200), reason varchar(200), sent_at timestamptz(3), created_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS customer_reply_notice_once ON customer_reply_notifications(message_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_reply_notice_due ON customer_reply_notifications(state,due_at);
