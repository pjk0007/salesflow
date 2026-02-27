CREATE TABLE IF NOT EXISTS "ai_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"api_key" varchar(500) NOT NULL,
	"model" varchar(100),
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_configs_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"provider" varchar(50) NOT NULL,
	"model" varchar(100) NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"purpose" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_template_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"partition_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"email_template_id" integer NOT NULL,
	"recipient_field" varchar(100) NOT NULL,
	"variable_mappings" jsonb,
	"trigger_type" varchar(30) DEFAULT 'manual' NOT NULL,
	"trigger_condition" jsonb,
	"repeat_config" jsonb,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_send_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"template_link_id" integer,
	"partition_id" integer,
	"record_id" integer,
	"email_template_id" integer,
	"recipient_email" varchar(200) NOT NULL,
	"subject" varchar(500),
	"request_id" varchar(100),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"result_code" varchar(20),
	"result_message" text,
	"trigger_type" varchar(30),
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"summary" varchar(500),
	"description" text,
	"category" varchar(100),
	"price" varchar(100),
	"url" varchar(500),
	"image_url" varchar(500),
	"is_active" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alimtalk_automation_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_link_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"org_id" uuid NOT NULL,
	"repeat_count" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_automation_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_link_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"org_id" uuid NOT NULL,
	"repeat_count" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "ai_configs" ADD CONSTRAINT "ai_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "email_template_links" ADD CONSTRAINT "email_template_links_partition_id_partitions_id_fk" FOREIGN KEY ("partition_id") REFERENCES "partitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "email_template_links" ADD CONSTRAINT "email_template_links_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "email_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "email_template_links" ADD CONSTRAINT "email_template_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_template_link_id_email_template_links_id_fk" FOREIGN KEY ("template_link_id") REFERENCES "email_template_links"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "alimtalk_automation_queue" ADD CONSTRAINT "alimtalk_automation_queue_template_link_id_alimtalk_template_links_id_fk" FOREIGN KEY ("template_link_id") REFERENCES "alimtalk_template_links"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "alimtalk_automation_queue" ADD CONSTRAINT "alimtalk_automation_queue_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "email_automation_queue" ADD CONSTRAINT "email_automation_queue_template_link_id_email_template_links_id_fk" FOREIGN KEY ("template_link_id") REFERENCES "email_template_links"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "email_automation_queue" ADD CONSTRAINT "email_automation_queue_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aq_status_next_run_idx" ON "alimtalk_automation_queue" USING btree ("status","next_run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aq_template_record_idx" ON "alimtalk_automation_queue" USING btree ("template_link_id","record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eq_status_next_run_idx" ON "email_automation_queue" USING btree ("status","next_run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eq_template_record_idx" ON "email_automation_queue" USING btree ("template_link_id","record_id");
--> statement-breakpoint
ALTER TABLE "alimtalk_template_links" ADD COLUMN IF NOT EXISTS "repeat_config" jsonb;
