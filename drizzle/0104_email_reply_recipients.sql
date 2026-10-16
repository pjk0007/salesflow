ALTER TABLE inbox_email_threads ADD COLUMN last_inbound_message_id integer REFERENCES inbox_messages(id) ON DELETE SET NULL;
ALTER TABLE inbox_email_deliveries ADD COLUMN recipient_to jsonb;
ALTER TABLE inbox_email_deliveries ADD COLUMN recipient_cc jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE inbox_email_deliveries ADD COLUMN reply_mode varchar(12) NOT NULL DEFAULT 'reply';
ALTER TABLE inbox_email_deliveries ADD COLUMN source_message_id integer REFERENCES inbox_messages(id) ON DELETE SET NULL;
ALTER TABLE inbox_email_deliveries ADD COLUMN request_fingerprint varchar(64);
UPDATE inbox_email_deliveries SET recipient_to=jsonb_build_array(recipient);
UPDATE inbox_email_threads t SET last_inbound_message_id=(
    SELECT max(r.message_id) FROM inbox_email_receipts r JOIN inbox_messages m ON m.id=r.message_id
    WHERE r.mailbox_id=t.mailbox_id AND m.conversation_id=t.conversation_id
        AND r.envelope->>'rfcMessageId'=t.last_rfc_message_id
);
ALTER TABLE inbox_email_deliveries ADD CONSTRAINT inbox_email_recipients_shape CHECK (
    (recipient_to IS NULL AND request_fingerprint IS NULL AND reply_mode='reply' AND jsonb_array_length(recipient_cc)=0)
    OR (recipient_to IS NOT NULL AND jsonb_typeof(recipient_to)='array' AND jsonb_typeof(recipient_cc)='array' AND jsonb_array_length(recipient_to)>=1 AND jsonb_array_length(recipient_to)+jsonb_array_length(recipient_cc)<=30)
);
ALTER TABLE inbox_email_deliveries ADD CONSTRAINT inbox_email_reply_mode CHECK (reply_mode IN ('reply','reply_all','custom'));
CREATE INDEX inbox_email_receipt_message ON inbox_email_receipts(message_id);
