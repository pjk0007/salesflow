DO $$ BEGIN
    ALTER TABLE "field_definitions" ADD COLUMN "is_sortable" integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
