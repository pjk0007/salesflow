ALTER TABLE "email_auto_personalized_links"
    ADD COLUMN IF NOT EXISTS "cta_url" varchar(500);
