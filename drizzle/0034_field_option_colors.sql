ALTER TABLE "field_definitions" ADD COLUMN IF NOT EXISTS "option_colors" jsonb;
ALTER TABLE "field_definitions" ADD COLUMN IF NOT EXISTS "option_style" varchar(10);
