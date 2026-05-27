-- tracker_events에 session_id 단독 인덱스 추가
-- SubPlan(세션별 PV 카운트) 성능 향상 — 풀스캔 → 인덱스 스캔
CREATE INDEX IF NOT EXISTS "tracker_events_session_idx" ON "tracker_events" ("session_id");
