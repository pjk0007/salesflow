CREATE TABLE IF NOT EXISTS "record_auto_enrich_rules" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "partition_id" integer NOT NULL REFERENCES "partitions"("id") ON DELETE CASCADE,
    "search_field" varchar(100) NOT NULL,
    "target_fields" jsonb NOT NULL DEFAULT '[]',
    "is_active" integer DEFAULT 1 NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);
