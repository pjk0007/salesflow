CREATE TABLE IF NOT EXISTS "ai_usage_quotas" (
    "id" SERIAL PRIMARY KEY,
    "org_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "month" VARCHAR(7) NOT NULL,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "quota_limit" INTEGER NOT NULL DEFAULT 100000,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE("org_id", "month")
);
