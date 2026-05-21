-- 방문자(트래커 visitor) ↔ record 다중 연결 (N:M)
-- 한 visitor가 여러 파티션의 record를 거쳐갈 때 모두 보존 (여정 끊김 방지)
CREATE TABLE IF NOT EXISTS "visitor_record_links" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL,
    "visitor_id" integer NOT NULL REFERENCES "tracker_visitors"("id") ON DELETE CASCADE,
    "record_id" integer NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
    "source" varchar(30) NOT NULL DEFAULT 'identify_match',
    "linked_at" timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("visitor_id", "record_id")
);
CREATE INDEX IF NOT EXISTS "vrl_visitor_idx" ON "visitor_record_links" ("visitor_id");
CREATE INDEX IF NOT EXISTS "vrl_record_idx" ON "visitor_record_links" ("record_id");

-- 백필: 기존 visitor.record_id → 링크
INSERT INTO "visitor_record_links" ("org_id", "visitor_id", "record_id", "source")
SELECT "org_id", "id", "record_id", 'backfill'
FROM "tracker_visitors"
WHERE "record_id" IS NOT NULL
ON CONFLICT ("visitor_id", "record_id") DO NOTHING;
