CREATE TABLE IF NOT EXISTS "email_auto_personalized_links" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "partition_id" integer NOT NULL REFERENCES "partitions"("id") ON DELETE CASCADE,
    "product_id" integer,
    "recipient_field" varchar(100) NOT NULL,
    "company_field" varchar(100) NOT NULL,
    "prompt" text,
    "tone" varchar(50),
    "trigger_type" varchar(20) NOT NULL DEFAULT 'on_create',
    "trigger_condition" jsonb,
    "auto_research" integer NOT NULL DEFAULT 1,
    "is_active" integer NOT NULL DEFAULT 1,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "eapl_partition_idx" ON "email_auto_personalized_links" ("partition_id");
