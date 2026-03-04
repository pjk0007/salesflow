ALTER TABLE "email_configs" ADD COLUMN IF NOT EXISTS "signature" text;
ALTER TABLE "email_configs" ADD COLUMN IF NOT EXISTS "signature_enabled" boolean DEFAULT false NOT NULL;
