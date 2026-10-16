CREATE TABLE inbox_email_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid NOT NULL REFERENCES inbox_email_receipts(id) ON DELETE CASCADE,
 file_index integer NOT NULL CHECK(file_index>=0), attachment_id uuid REFERENCES inbox_attachments(id),
 state varchar(16) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','available','failed','blocked')),
 error_code varchar(40), created_at timestamptz(3) NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX inbox_email_file_once ON inbox_email_files(receipt_id,file_index);
--> statement-breakpoint
INSERT INTO inbox_email_files(receipt_id,file_index,state,error_code)
SELECT r.id, f.ordinality-1,
 CASE WHEN (f.item->>'size')::bigint > 20971520 OR (f.item->>'size')::bigint = 0 THEN 'blocked' ELSE 'pending' END,
 CASE WHEN (f.item->>'size')::bigint > 20971520 THEN 'too_large' WHEN (f.item->>'size')::bigint = 0 THEN 'empty_file' ELSE NULL END
FROM inbox_email_receipts r, jsonb_array_elements(coalesce(r.envelope->'files','[]'::jsonb)) WITH ORDINALITY AS f(item,ordinality)
WHERE r.message_id IS NOT NULL;
