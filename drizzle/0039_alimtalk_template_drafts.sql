CREATE TABLE IF NOT EXISTS "alimtalk_template_drafts" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "sender_key" varchar(200) NOT NULL,
    "template_code" varchar(100) NOT NULL,
    "template_name" varchar(200) NOT NULL,
    "form_data" jsonb NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);
