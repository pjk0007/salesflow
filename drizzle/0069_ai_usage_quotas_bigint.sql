-- Enterprise 월 한도를 50억으로 올리면 int4 상한(2,147,483,647)을 넘는다.
-- quota_limit만이 아니라 total_tokens도 한도까지 누적되므로 두 컬럼을 함께 바꾼다.
-- 한 문장에 두 subcommand를 넣어 테이블 리라이트를 1회로 끝낸다 — 행 수는 org × 월 수 규모다.
ALTER TABLE "ai_usage_quotas"
    ALTER COLUMN "total_tokens" TYPE bigint,
    ALTER COLUMN "quota_limit" TYPE bigint;
