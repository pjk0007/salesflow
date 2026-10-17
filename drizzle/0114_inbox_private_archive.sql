ALTER TABLE inbox_attachments ADD COLUMN IF NOT EXISTS storage_object_key varchar(512);
--> statement-breakpoint
ALTER TABLE inbox_attachments DROP CONSTRAINT IF EXISTS inbox_attachment_size;
--> statement-breakpoint
ALTER TABLE inbox_attachments ADD CONSTRAINT inbox_attachment_size CHECK (
    size > 0 AND size <= 1073741824 AND (size <= 20971520 OR storage_object_key IS NOT NULL)
);
