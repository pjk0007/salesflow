CREATE TABLE IF NOT EXISTS "journey_lead_followups" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "customer_key" varchar(64) NOT NULL,
    "record_id" integer NOT NULL,
    "first_urgent_at" timestamptz,
    "status" varchar(20) DEFAULT 'new' NOT NULL CHECK ("status" IN ('new','planned','contacted','consulting')),
    "due_at" timestamptz,
    "note" text DEFAULT '' NOT NULL,
    "revision" integer DEFAULT 0 NOT NULL,
    "updated_by" uuid,
    "updated_by_name" varchar(100),
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    "last_reminded_at" timestamptz,
    "next_reminder_check_at" timestamptz DEFAULT now() NOT NULL,
    "reminder_count" integer DEFAULT 0 NOT NULL,
    "reminder_result" varchar(20),
    CHECK ("status" <> 'planned' OR "due_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jlf_customer_idx" ON "journey_lead_followups" ("org_id","workspace_id","customer_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jlf_due_idx" ON "journey_lead_followups" ("status","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cja_cohort_idx" ON "customer_journey_alerts" ("org_id","workspace_id","created_at");
--> statement-breakpoint
-- 기존 판정도 화면에서 처리할 수 있게 준비한다. 미확인 재알림의 24시간은 배포 시점부터 센다.
INSERT INTO "journey_lead_followups" ("org_id","workspace_id","customer_key","record_id","first_urgent_at")
SELECT a.org_id,a.workspace_id,a.message->'journeyPriority'->>'customerKey',
    (array_agg(a.record_id ORDER BY a.last_activity_at DESC,a.id DESC))[1],
    CASE WHEN bool_or(a.message->'journeyPriority'->>'tier'='urgent') THEN now() ELSE NULL END
FROM customer_journey_alerts a JOIN workspaces w ON w.id=a.workspace_id AND w.org_id=a.org_id
JOIN records r ON r.id=a.record_id AND r.org_id=a.org_id AND r.workspace_id=a.workspace_id
WHERE a.created_at >= now()-interval '30 days' AND a.created_at<=now() AND a.status<>'skipped'
    AND a.message->'journeyPriority'->>'version'='1' AND a.message->'journeyPriority'->>'rankEligible'='true'
    AND a.message->'journeyPriority'->>'tier' IN ('highlight','urgent')
    AND a.message->'journeyPriority'->>'customerKey' ~ '^[a-f0-9]{64}$'
GROUP BY a.org_id,a.workspace_id,a.message->'journeyPriority'->>'customerKey'
ON CONFLICT (org_id,workspace_id,customer_key) DO NOTHING;
