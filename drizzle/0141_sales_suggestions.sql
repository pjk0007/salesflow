-- 영업 추천 할 일 (2026-11-12 주희님): 규칙(오래 연락 안 함·명절 인사)이 만든 추천은 액션플랜과 같은 표에 'suggested'로 둔다.
-- 사람이 [할 일로 추가]하면 'open', [건너뛰기]하면 dismissed_at.
ALTER TABLE "sales_action_items" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_action_items" ADD COLUMN IF NOT EXISTS "rule_key" varchar(60);
--> statement-breakpoint
ALTER TABLE "sales_action_items" ADD COLUMN IF NOT EXISTS "reason" text;
--> statement-breakpoint
ALTER TABLE "sales_action_items" ADD COLUMN IF NOT EXISTS "draft" text;
--> statement-breakpoint
ALTER TABLE "sales_action_items" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_action_items_rule_idx" ON "sales_action_items" ("record_id", "rule_key");
--> statement-breakpoint
-- 조직별 영업 규칙 (켜고 끄기·기준 일수)
CREATE TABLE IF NOT EXISTS "sales_rules" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL,
    "kind" varchar(40) NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "sales_rules_org_kind_unique" UNIQUE ("org_id", "kind")
);
