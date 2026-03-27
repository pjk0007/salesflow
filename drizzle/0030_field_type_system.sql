-- Step 1: field_types 테이블 생성
CREATE TABLE IF NOT EXISTS "field_types" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "name" varchar(100) NOT NULL,
    "description" text,
    "icon" varchar(50),
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    UNIQUE("org_id", "name")
);

-- Step 2: field_definitions에 field_type_id 추가
DO $$ BEGIN
    ALTER TABLE "field_definitions" ADD COLUMN "field_type_id" integer REFERENCES "field_types"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "field_definitions" ALTER COLUMN "workspace_id" DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

-- Step 3: workspaces에 default_field_type_id 추가
DO $$ BEGIN
    ALTER TABLE "workspaces" ADD COLUMN "default_field_type_id" integer REFERENCES "field_types"("id");
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Step 4: partitions에 field_type_id 추가
DO $$ BEGIN
    ALTER TABLE "partitions" ADD COLUMN "field_type_id" integer REFERENCES "field_types"("id");
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
