ALTER TABLE "email_auto_personalized_links"
    ADD COLUMN IF NOT EXISTS "is_draft" integer DEFAULT 0 NOT NULL;
