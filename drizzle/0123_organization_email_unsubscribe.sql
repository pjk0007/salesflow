-- Historical rows become account-wide suppression; retain every source row and timestamp.
-- A removed source workspace must not remove the organization's opt-out.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "email_unsubscribes" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
DO $$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT c.conname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'email_unsubscribes'::regclass
          AND c.contype = 'f' AND a.attname = 'workspace_id'
    LOOP
        EXECUTE format('ALTER TABLE email_unsubscribes DROP CONSTRAINT %I', constraint_name);
    END LOOP;
    ALTER TABLE "email_unsubscribes"
        ADD CONSTRAINT "email_unsubscribes_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL;
END $$;
--> statement-breakpoint
-- Same trim character set as EMAIL_TRIM_CHARS. Non-unique preserves historical attribution.
CREATE INDEX IF NOT EXISTS "email_unsubscribes_org_normalized_email_idx"
    ON "email_unsubscribes" ("org_id", lower(btrim("email", E' \t\n\u000b\f\r\u00a0\u3000\ufeff\u200b')));
