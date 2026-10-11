-- 발송 대기열 우선순위 (docs/2026-10-02-sender-warmup/DESIGN-2-queue-policy.md 2절)
-- 0 = 대량 명단(가져오기·예약 등록으로 들어온 줄), 1 = 문의(한 건씩 생긴 레코드)가 발신 한도에 막혀 들어온 줄 (enqueueDeferredSend).
-- 꺼낼 때 1이 먼저다: ORDER BY priority DESC, scheduled_at, id. 1인 줄은 문의 몫(그날 한도의 10%)까지 쓴다.
-- 기존 줄은 전부 0이 된다 — 지금까지는 둘을 가르지 않았으므로 예전처럼 먼저 들어온 순으로 나간다.
-- 상수 기본값이라 PostgreSQL 11 이상에서는 표를 다시 쓰지 않는다.
ALTER TABLE "email_send_queue" ADD COLUMN IF NOT EXISTS "priority" smallint DEFAULT 0 NOT NULL;

-- 배포 때 이미 기다리던 on_update 줄은 모두 문의다 — 대기열에 on_update 줄을 넣는 곳은 문의가 막혔을 때의 enqueueDeferredSend뿐이다
-- (대량 경로 가져오기·예약 등록·enqueue-unsent는 on_create만 넣는다). 0으로 두면 대량으로 다뤄져 15:00 전 문의 몫을 못 쓰고,
-- 같은 레코드가 다시 고쳐져도 pending 줄은 올려지지 않는다. 다시 돌려도 같다 (priority = 0인 줄만).
-- on_create 문의 줄은 대량 줄과 가를 수 없어 0 그대로 둔다 (예전처럼 먼저 들어온 순).
UPDATE "email_send_queue" SET "priority" = 1
 WHERE "trigger_type" = 'on_update' AND "status" IN ('pending', 'processing') AND "priority" = 0;

-- 줄 집기 색인을 새 순서에 맞춘다. 예전 색인(status, scheduled_at, id)으로는 꺼낼 때가 된 줄을 전부 읽어 정렬해야 한다
DROP INDEX IF EXISTS "esq_pickup_idx";
CREATE INDEX IF NOT EXISTS "esq_pickup_priority_idx" ON "email_send_queue" USING btree ("status", "priority" DESC, "scheduled_at", "id");
