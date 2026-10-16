ALTER TABLE inbox_teams ADD COLUMN require_available boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE inbox_agent_availability (
 channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state varchar(16) NOT NULL DEFAULT 'away',
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz(3) NOT NULL DEFAULT now(),
 PRIMARY KEY (channel_id,user_id),
 CONSTRAINT inbox_agent_state_valid CHECK (state IN ('available','away'))
);
--> statement-breakpoint
CREATE TABLE inbox_agent_sessions (
 channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 sequence integer NOT NULL,
 conversation_id uuid REFERENCES inbox_conversations(id) ON DELETE CASCADE,
 activity varchar(16) NOT NULL DEFAULT 'viewing',
 typing_until timestamptz(3),
 expires_at timestamptz(3) NOT NULL,
 PRIMARY KEY(channel_id,user_id,session_id),
 CONSTRAINT inbox_agent_activity_valid CHECK (activity IN ('viewing','reply','note')),
 CONSTRAINT inbox_agent_sequence_valid CHECK (sequence>=0)
);
--> statement-breakpoint
CREATE INDEX inbox_agent_sessions_live ON inbox_agent_sessions(channel_id,expires_at);
