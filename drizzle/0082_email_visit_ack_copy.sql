SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE email_visit_acknowledgements ADD COLUMN IF NOT EXISTS body text;
