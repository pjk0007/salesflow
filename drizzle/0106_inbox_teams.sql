CREATE TABLE inbox_teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    description varchar(500) NOT NULL DEFAULT '',
    auto_assign boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamp(3) with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_team_name ON inbox_teams(channel_id, lower(name));
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_team_channel_key ON inbox_teams(id, channel_id);
--> statement-breakpoint
CREATE TABLE inbox_team_members (
    team_id uuid NOT NULL REFERENCES inbox_teams(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_assigned_at timestamp(3) with time zone,
    PRIMARY KEY (team_id, user_id)
);
--> statement-breakpoint
ALTER TABLE inbox_conversations ADD COLUMN team_id uuid;
--> statement-breakpoint
ALTER TABLE inbox_conversations ADD CONSTRAINT inbox_conversation_team_channel
    FOREIGN KEY (team_id, channel_id) REFERENCES inbox_teams(id, channel_id);
--> statement-breakpoint
CREATE INDEX inbox_team_queue ON inbox_conversations(channel_id, team_id, last_message_at, id) WHERE merged_into_id IS NULL;
