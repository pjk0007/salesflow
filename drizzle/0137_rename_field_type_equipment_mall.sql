-- 리드 속성 타입 '제조 견적'을 '설비지원몰 견적'으로 (워크스페이스 이름 변경에 맞춤, 2026-11-11)
UPDATE "field_types" SET "name" = '설비지원몰 견적', "updated_at" = now()
WHERE "name" = '제조 견적'
  AND NOT EXISTS (SELECT 1 FROM "field_types" t WHERE t."name" = '설비지원몰 견적' AND t."org_id" = "field_types"."org_id");
