DO $$ BEGIN
    ALTER TABLE "users" ADD COLUMN "is_super_admin" integer DEFAULT 0 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 초기 super admin 지정
UPDATE "users" SET "is_super_admin" = 1 WHERE "email" = 'cto@matchesplan.com';
