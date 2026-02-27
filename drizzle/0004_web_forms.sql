CREATE TABLE IF NOT EXISTS "web_forms" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "partition_id" integer NOT NULL REFERENCES "partitions"("id") ON DELETE CASCADE,
    "name" varchar(200) NOT NULL,
    "slug" varchar(100) NOT NULL,
    "title" varchar(200) NOT NULL,
    "description" text,
    "completion_title" varchar(200) DEFAULT '제출이 완료되었습니다',
    "completion_message" text,
    "completion_button_text" varchar(100),
    "completion_button_url" text,
    "default_values" jsonb,
    "is_active" integer DEFAULT 1 NOT NULL,
    "created_by" uuid REFERENCES "users"("id"),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "web_forms_slug_unique" ON "web_forms" ("slug");

CREATE TABLE IF NOT EXISTS "web_form_fields" (
    "id" serial PRIMARY KEY NOT NULL,
    "form_id" integer NOT NULL REFERENCES "web_forms"("id") ON DELETE CASCADE,
    "label" varchar(200) NOT NULL,
    "description" text,
    "placeholder" varchar(200),
    "field_type" varchar(20) DEFAULT 'text' NOT NULL,
    "linked_field_key" varchar(100),
    "is_required" integer DEFAULT 0 NOT NULL,
    "options" jsonb,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
