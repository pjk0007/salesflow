ALTER TABLE "partitions" ADD COLUMN IF NOT EXISTS "category" varchar(20) NOT NULL DEFAULT 'cold';

-- 리드 파티션 지정
UPDATE "partitions" SET "category" = 'lead' WHERE "id" IN (38, 36, 37, 56, 89, 90, 91, 96);
