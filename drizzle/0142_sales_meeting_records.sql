-- 미팅 ↔ 연결된 리드 (2026-11-12 주희님): 같은 기업 담당자 여럿이 들어간 미팅을 그 담당자 리드들에도 보이게 한다.
-- sales_meetings.record_id는 처음 기록한 리드 그대로 두고, 여기에는 함께 참석한 다른 리드만 넣는다. 할 일은 미팅에 하나만 있다.
CREATE TABLE IF NOT EXISTS "sales_meeting_records" (
    "meeting_id" integer NOT NULL REFERENCES "sales_meetings"("id") ON DELETE CASCADE,
    "record_id" integer NOT NULL REFERENCES "records"("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("meeting_id", "record_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_meeting_records_record_idx" ON "sales_meeting_records" ("record_id");
