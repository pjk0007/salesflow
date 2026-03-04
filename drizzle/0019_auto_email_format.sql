ALTER TABLE "email_auto_personalized_links" ADD COLUMN IF NOT EXISTS "format" varchar(20) DEFAULT 'plain' NOT NULL;
