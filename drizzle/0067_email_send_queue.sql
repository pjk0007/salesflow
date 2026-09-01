CREATE TABLE IF NOT EXISTS "email_send_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"record_id" integer NOT NULL,
	"partition_id" integer NOT NULL,
	"org_id" uuid NOT NULL,
	"trigger_type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_send_queue" ADD CONSTRAINT "email_send_queue_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_send_queue" ADD CONSTRAINT "email_send_queue_partition_id_partitions_id_fk" FOREIGN KEY ("partition_id") REFERENCES "public"."partitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esq_pickup_idx" ON "email_send_queue" USING btree ("status","scheduled_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "esq_record_trigger_idx" ON "email_send_queue" USING btree ("record_id","trigger_type");
