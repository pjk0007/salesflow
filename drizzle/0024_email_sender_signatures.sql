-- 이메일 발신자 프로필 (조직별 다중)
CREATE TABLE IF NOT EXISTS "email_sender_profiles" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "name" varchar(100) NOT NULL,
    "from_name" varchar(100) NOT NULL,
    "from_email" varchar(200) NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- 이메일 서명 (조직별 다중)
CREATE TABLE IF NOT EXISTS "email_signatures" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "name" varchar(100) NOT NULL,
    "signature" text NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- 기존 emailConfigs에서 데이터 마이그레이션 (중복 방지)
INSERT INTO "email_sender_profiles" ("org_id", "name", "from_name", "from_email", "is_default", "created_at", "updated_at")
SELECT "org_id", '기본 발신자', "from_name", "from_email", true, NOW(), NOW()
FROM "email_configs"
WHERE "from_name" IS NOT NULL AND "from_email" IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM "email_sender_profiles" sp WHERE sp."org_id" = "email_configs"."org_id" AND sp."is_default" = true);

INSERT INTO "email_signatures" ("org_id", "name", "signature", "is_default", "created_at", "updated_at")
SELECT "org_id", '기본 서명', "signature", true, NOW(), NOW()
FROM "email_configs"
WHERE "signature" IS NOT NULL AND "signature" != ''
AND NOT EXISTS (SELECT 1 FROM "email_signatures" es WHERE es."org_id" = "email_configs"."org_id" AND es."is_default" = true);
