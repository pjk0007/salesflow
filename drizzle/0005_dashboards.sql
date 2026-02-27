CREATE TABLE IF NOT EXISTS "dashboards" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "name" varchar(200) NOT NULL,
    "slug" varchar(100) NOT NULL,
    "description" text,
    "global_filters" jsonb,
    "refresh_interval" integer DEFAULT 60 NOT NULL,
    "is_public" integer DEFAULT 0 NOT NULL,
    "created_by" uuid REFERENCES "users"("id"),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "dashboards_slug_unique" ON "dashboards" ("slug");

CREATE TABLE IF NOT EXISTS "dashboard_widgets" (
    "id" serial PRIMARY KEY NOT NULL,
    "dashboard_id" integer NOT NULL REFERENCES "dashboards"("id") ON DELETE CASCADE,
    "title" varchar(200) NOT NULL,
    "widget_type" varchar(20) NOT NULL,
    "data_column" varchar(100) NOT NULL,
    "aggregation" varchar(20) DEFAULT 'count' NOT NULL,
    "group_by_column" varchar(100),
    "stack_by_column" varchar(100),
    "widget_filters" jsonb,
    "layout_x" integer DEFAULT 0 NOT NULL,
    "layout_y" integer DEFAULT 0 NOT NULL,
    "layout_w" integer DEFAULT 4 NOT NULL,
    "layout_h" integer DEFAULT 3 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
