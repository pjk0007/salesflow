ALTER TABLE inbox_conversations ADD COLUMN merged_into_id uuid REFERENCES inbox_conversations(id);
ALTER TABLE inbox_conversations ADD COLUMN identified_at timestamptz(3);
ALTER TABLE inbox_conversations ADD CONSTRAINT inbox_merge_not_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);
CREATE INDEX inbox_merge_target ON inbox_conversations(merged_into_id) WHERE merged_into_id IS NOT NULL;
ALTER TABLE inbox_messages ADD COLUMN origin_conversation_id uuid REFERENCES inbox_conversations(id);
