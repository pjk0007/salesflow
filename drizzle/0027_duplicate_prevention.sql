DO $$ BEGIN
    ALTER TABLE "email_template_links" ADD COLUMN "prevent_duplicate" integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "email_auto_personalized_links" ADD COLUMN "prevent_duplicate" integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "partitions" ADD COLUMN "duplicate_config" jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
