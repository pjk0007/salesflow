DO $$ BEGIN
    ALTER TABLE "alimtalk_template_links" ADD COLUMN "prevent_duplicate" integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
