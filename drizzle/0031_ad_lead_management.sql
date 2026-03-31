-- 광고 플랫폼 연결
CREATE TABLE IF NOT EXISTS "ad_platforms" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "platform" varchar(20) NOT NULL,
    "name" varchar(200) NOT NULL,
    "credentials" jsonb NOT NULL,
    "status" varchar(20) DEFAULT 'connected' NOT NULL,
    "last_sync_at" timestamp with time zone,
    "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ad_platforms_org_id_platform_name_unique" UNIQUE("org_id", "platform", "name")
);

-- 광고 계정
CREATE TABLE IF NOT EXISTS "ad_accounts" (
    "id" serial PRIMARY KEY NOT NULL,
    "ad_platform_id" integer NOT NULL REFERENCES "ad_platforms"("id") ON DELETE CASCADE,
    "workspace_id" integer REFERENCES "workspaces"("id") ON DELETE SET NULL,
    "external_account_id" varchar(100) NOT NULL,
    "name" varchar(200) NOT NULL,
    "currency" varchar(10),
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "metadata" jsonb,
    "last_sync_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ad_accounts_ad_platform_id_external_account_id_unique" UNIQUE("ad_platform_id", "external_account_id")
);

-- 광고 리드 연동 설정
CREATE TABLE IF NOT EXISTS "ad_lead_integrations" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "ad_account_id" integer NOT NULL REFERENCES "ad_accounts"("id") ON DELETE CASCADE,
    "name" varchar(200) NOT NULL,
    "platform" varchar(20) NOT NULL,
    "partition_id" integer REFERENCES "partitions"("id") ON DELETE SET NULL,
    "form_id" varchar(200) NOT NULL,
    "form_name" varchar(200),
    "field_mappings" jsonb NOT NULL,
    "default_values" jsonb,
    "is_active" integer DEFAULT 1 NOT NULL,
    "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ad_lead_integrations_ad_account_id_form_id_unique" UNIQUE("ad_account_id", "form_id")
);

CREATE INDEX IF NOT EXISTS "ad_lead_integrations_form_id_idx" ON "ad_lead_integrations" ("form_id");
CREATE INDEX IF NOT EXISTS "ad_lead_integrations_platform_idx" ON "ad_lead_integrations" ("platform");

-- 광고 리드 수집 로그
CREATE TABLE IF NOT EXISTS "ad_lead_logs" (
    "id" serial PRIMARY KEY NOT NULL,
    "integration_id" integer NOT NULL REFERENCES "ad_lead_integrations"("id") ON DELETE CASCADE,
    "external_lead_id" varchar(200),
    "record_id" integer,
    "raw_data" jsonb,
    "status" varchar(20) DEFAULT 'success' NOT NULL,
    "error_message" text,
    "processed_at" timestamp with time zone DEFAULT now(),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ad_lead_logs_integration_created_idx" ON "ad_lead_logs" ("integration_id", "created_at");
CREATE INDEX IF NOT EXISTS "ad_lead_logs_external_lead_idx" ON "ad_lead_logs" ("external_lead_id");
