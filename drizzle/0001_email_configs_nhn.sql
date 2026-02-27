ALTER TABLE "email_configs" DROP COLUMN IF EXISTS "provider";
ALTER TABLE "email_configs" DROP COLUMN IF EXISTS "smtp_host";
ALTER TABLE "email_configs" DROP COLUMN IF EXISTS "smtp_port";
ALTER TABLE "email_configs" DROP COLUMN IF EXISTS "smtp_user";
ALTER TABLE "email_configs" DROP COLUMN IF EXISTS "smtp_pass";
ALTER TABLE "email_configs" ADD COLUMN IF NOT EXISTS "app_key" varchar(200) NOT NULL DEFAULT '';
ALTER TABLE "email_configs" ADD COLUMN IF NOT EXISTS "secret_key" varchar(200) NOT NULL DEFAULT '';
ALTER TABLE "email_configs" ALTER COLUMN "app_key" DROP DEFAULT;
ALTER TABLE "email_configs" ALTER COLUMN "secret_key" DROP DEFAULT;
