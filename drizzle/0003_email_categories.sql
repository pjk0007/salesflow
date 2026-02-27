CREATE TABLE IF NOT EXISTS "email_categories" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "name" varchar(200) NOT NULL,
    "description" varchar(1000),
    "nhn_category_id" integer,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "category_id" integer REFERENCES "email_categories"("id") ON DELETE SET NULL;
