CREATE TABLE inbox_operations_settings (
 channel_id integer PRIMARY KEY REFERENCES inbox_channels(id) ON DELETE CASCADE,org_id uuid NOT NULL REFERENCES organizations(id),version integer NOT NULL DEFAULT 1,policy jsonb NOT NULL,effective_at timestamptz(3) NOT NULL DEFAULT now(),updated_by uuid REFERENCES users(id),updated_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE inbox_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id),channel_id integer NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_key varchar(250) NOT NULL,type varchar(30) NOT NULL,preview varchar(250) NOT NULL,customer_seq integer,read_at timestamptz(3),created_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_notification_once ON inbox_notifications(user_id,event_key);
--> statement-breakpoint
CREATE INDEX inbox_notification_user_recent ON inbox_notifications(org_id,user_id,created_at,id);
--> statement-breakpoint
CREATE TABLE inbox_service_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id),channel_id integer NOT NULL REFERENCES inbox_channels(id),conversation_id uuid NOT NULL REFERENCES inbox_conversations(id),origin_conversation_id uuid NOT NULL REFERENCES inbox_conversations(id),opened_message_id integer NOT NULL REFERENCES inbox_messages(id),started_at timestamptz(3) NOT NULL,recorded_at timestamptz(3) NOT NULL DEFAULT now(),policy jsonb NOT NULL,policy_version integer NOT NULL,policy_effective_at timestamptz(3),sla_applied boolean NOT NULL,first_reply_at timestamptz(3),first_reply_ms bigint,first_responder varchar(10),last_reply_at timestamptz(3),closed_at timestamptz(3),resolution_ms bigint,resolution_due_at timestamptz(3),resolution_breached_at timestamptz(3),paused_at timestamptz(3),paused_ms bigint NOT NULL DEFAULT 0,assignee_at_close uuid REFERENCES users(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_case_opened_once ON inbox_service_cases(opened_message_id);
--> statement-breakpoint
CREATE INDEX inbox_case_channel_started ON inbox_service_cases(channel_id,started_at,id);
--> statement-breakpoint
CREATE INDEX inbox_case_conversation ON inbox_service_cases(conversation_id);
--> statement-breakpoint
CREATE INDEX inbox_case_resolution_due ON inbox_service_cases(resolution_due_at) WHERE closed_at IS NULL AND resolution_breached_at IS NULL;
--> statement-breakpoint
CREATE TABLE inbox_response_obligations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES inbox_service_cases(id) ON DELETE CASCADE,requested_message_id integer NOT NULL REFERENCES inbox_messages(id),kind varchar(10) NOT NULL,started_at timestamptz(3) NOT NULL,due_at timestamptz(3),responded_at timestamptz(3),reply_message_id integer REFERENCES inbox_messages(id),elapsed_ms bigint,responder varchar(10),paused_ms bigint NOT NULL DEFAULT 0,breached_at timestamptz(3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_response_requested_once ON inbox_response_obligations(requested_message_id);
--> statement-breakpoint
CREATE INDEX inbox_response_case ON inbox_response_obligations(case_id);
--> statement-breakpoint
CREATE INDEX inbox_response_due ON inbox_response_obligations(due_at) WHERE responded_at IS NULL AND breached_at IS NULL;
