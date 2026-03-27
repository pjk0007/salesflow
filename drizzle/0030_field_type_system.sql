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

-- Step 5: 데이터 마이그레이션 — 워크스페이스별 field_types 자동 생성 및 연결
-- field_type_id가 아직 안 채워진 field_definitions가 있을 때만 실행 (idempotent)
DO $$
DECLARE
    ws RECORD;
    new_type_id integer;
BEGIN
    -- field_definitions에 field_type_id가 null인 것이 있으면 마이그레이션 실행
    IF NOT EXISTS (SELECT 1 FROM field_definitions WHERE field_type_id IS NULL AND workspace_id IS NOT NULL) THEN
        RETURN;
    END IF;

    -- 각 워크스페이스마다 타입 생성
    FOR ws IN
        SELECT DISTINCT w.id as ws_id, w.org_id, w.name as ws_name
        FROM workspaces w
        JOIN field_definitions fd ON fd.workspace_id = w.id AND fd.field_type_id IS NULL
    LOOP
        -- 이미 같은 이름의 타입이 있으면 사용, 없으면 생성
        SELECT id INTO new_type_id
        FROM field_types
        WHERE org_id = ws.org_id AND name = ws.ws_name;

        IF new_type_id IS NULL THEN
            INSERT INTO field_types (org_id, name, description)
            VALUES (ws.org_id, ws.ws_name, ws.ws_name || ' 속성 타입')
            RETURNING id INTO new_type_id;
        END IF;

        -- field_definitions 연결
        UPDATE field_definitions
        SET field_type_id = new_type_id
        WHERE workspace_id = ws.ws_id AND field_type_id IS NULL;

        -- workspace에 default_field_type_id 설정
        UPDATE workspaces
        SET default_field_type_id = new_type_id
        WHERE id = ws.ws_id AND default_field_type_id IS NULL;
    END LOOP;
END $$;
