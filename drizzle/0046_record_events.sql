-- record_events: record에 일어난 비즈니스 이벤트 이력 (append-only)
CREATE TABLE IF NOT EXISTS "record_events" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL,
    "record_id" integer NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
    "type" varchar(50) NOT NULL,
    "label" varchar(100) NOT NULL,
    "occurred_at" timestamptz NOT NULL DEFAULT now(),
    "meta" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "record_events_record_occurred_idx"
    ON "record_events" ("record_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "record_events_org_type_idx"
    ON "record_events" ("org_id", "type");
