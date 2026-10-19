CREATE TABLE IF NOT EXISTS inbox_chat_alert_deliveries (
    message_id integer PRIMARY KEY REFERENCES inbox_messages(id) ON DELETE CASCADE,
    route_hash varchar(64) NOT NULL,
    state varchar(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','retry','sent','dead','cancelled')),
    attempts integer NOT NULL DEFAULT 0,
    sent_parts integer NOT NULL DEFAULT 0,
    available_at timestamptz(3) NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz(3),
    last_status integer,
    last_error varchar(500),
    delivered_at timestamptz(3),
    created_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbox_chat_alert_due ON inbox_chat_alert_deliveries(available_at)
WHERE state IN ('pending','retry','processing');
