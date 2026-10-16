CREATE TABLE inbox_message_mentions (
    message_id integer NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id uuid NOT NULL REFERENCES organizations(id),
    channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    created_at timestamptz(3) NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id,user_id)
);
CREATE INDEX inbox_message_mention_user_conversation ON inbox_message_mentions(org_id,user_id,conversation_id);
ALTER TABLE inbox_notifications ADD COLUMN message_id integer REFERENCES inbox_messages(id) ON DELETE SET NULL;
