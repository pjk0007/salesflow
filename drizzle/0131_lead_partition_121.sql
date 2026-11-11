-- KSFC "2027 스마트공장 통합공고 사전 문의"를 리드 관리로 (2026-11-11 주희님 확인). 번호+이름이 같을 때만
UPDATE "partitions" SET "category" = 'lead' WHERE "id" = 121 AND "name" = '2027 스마트공장 통합공고 사전 문의';
--> statement-breakpoint
-- 대응상태가 비어 있는 이 파티션 리드는 '신규' (0130과 같은 규칙)
UPDATE records r
SET data = r.data || '{"status": "신규"}'::jsonb
FROM partitions p
WHERE p.id = r.partition_id
  AND p.id = 121
  AND p.category = 'lead'
  AND COALESCE(r.data->>'status', '') = '';
