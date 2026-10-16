ALTER TABLE inbox_channels ADD COLUMN reply_guard_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE inbox_channels ADD COLUMN reply_guard_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE inbox_conversations ADD COLUMN reply_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE inbox_reply_leases (
    conversation_id uuid PRIMARY KEY REFERENCES inbox_conversations(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id uuid NOT NULL,
    guard_version integer NOT NULL,
    base_revision integer NOT NULL,
    expires_at timestamptz(3) NOT NULL,
    CONSTRAINT inbox_reply_lease_revision_valid CHECK (base_revision>=0 AND guard_version>=0)
);
--> statement-breakpoint
CREATE INDEX inbox_reply_leases_expiry ON inbox_reply_leases(expires_at);
