-- 기존 "등록일" 커스텀 필드(data.registeredAt)를 시스템 컬럼 매핑으로 전환.
-- 시스템 매핑 필드는 records.registered_at(시스템 값)을 읽으므로 항상 값이 차있음.
-- 멱등: 이미 전환된 건(system_column NOT NULL)은 건드리지 않음.
UPDATE "field_definitions"
SET "system_column" = 'registeredAt',
    "is_system" = 1,
    "cell_type" = 'readonly',
    "field_type" = 'datetime'
WHERE "key" = 'registeredAt' AND "system_column" IS NULL;
