ALTER TABLE "email_auto_personalized_links" ADD COLUMN IF NOT EXISTS "sender_profile_id" integer;
ALTER TABLE "email_auto_personalized_links" ADD COLUMN IF NOT EXISTS "signature_id" integer;