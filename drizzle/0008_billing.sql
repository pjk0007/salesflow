CREATE TABLE IF NOT EXISTS "plans" (
    "id" serial PRIMARY KEY,
    "name" varchar(50) NOT NULL,
    "slug" varchar(50) UNIQUE NOT NULL,
    "price" integer NOT NULL,
    "limits" jsonb NOT NULL,
    "features" jsonb NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "plan_id" integer NOT NULL REFERENCES "plans"("id"),
    "status" varchar(20) NOT NULL DEFAULT 'active',
    "current_period_start" timestamptz,
    "current_period_end" timestamptz,
    "toss_customer_key" varchar(200),
    "toss_billing_key" varchar(200),
    "canceled_at" timestamptz,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payments" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "subscription_id" integer REFERENCES "subscriptions"("id"),
    "amount" integer NOT NULL,
    "status" varchar(20) NOT NULL,
    "toss_payment_key" varchar(200),
    "toss_order_id" varchar(200),
    "paid_at" timestamptz,
    "fail_reason" text,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- 초기 플랜 데이터
INSERT INTO "plans" ("name", "slug", "price", "limits", "features", "sort_order") VALUES
    ('Free', 'free', 0, '{"workspaces":1,"records":500,"members":2}', '["워크스페이스 1개","레코드 500건","멤버 2명","기본 대시보드","이메일 발송"]', 0),
    ('Pro', 'pro', 29000, '{"workspaces":3,"records":10000,"members":10}', '["워크스페이스 3개","레코드 10,000건","멤버 10명","AI 도우미","이메일/알림톡 자동화","고급 대시보드"]', 1),
    ('Enterprise', 'enterprise', 99000, '{"workspaces":-1,"records":-1,"members":-1}', '["무제한 워크스페이스","무제한 레코드","무제한 멤버","우선 지원","전용 온보딩","API 접근"]', 2);

-- 기존 조직에 Free 구독 생성
INSERT INTO "subscriptions" ("org_id", "plan_id", "status")
    SELECT o."id", (SELECT "id" FROM "plans" WHERE "slug" = 'free'), 'active'
    FROM "organizations" o
    WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."org_id" = o."id");
