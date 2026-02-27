ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'published' NOT NULL;
