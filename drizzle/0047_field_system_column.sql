-- field_definitions에 시스템 컬럼 매핑 추가
-- NULL = 커스텀 필드(기존), 값 = 시스템 컬럼 매핑 (registeredAt|createdAt|updatedAt)
ALTER TABLE "field_definitions" ADD COLUMN IF NOT EXISTS "system_column" varchar(50);
