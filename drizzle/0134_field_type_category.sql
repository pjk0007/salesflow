-- 속성 타입도 레코드(cold) / 리드(lead)로 나눈다 — 설정에서 탭을 따로 보여준다 (2026-11-11 주희님 요청)
ALTER TABLE "field_types" ADD COLUMN IF NOT EXISTS "category" varchar(20) NOT NULL DEFAULT 'cold';
--> statement-breakpoint
-- 리드 파티션만 쓰는 타입은 리드용
UPDATE field_types ft SET category = 'lead'
WHERE EXISTS (
    SELECT 1 FROM partitions p JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.category = 'lead' AND COALESCE(p.field_type_id, w.default_field_type_id) = ft.id
)
AND NOT EXISTS (
    SELECT 1 FROM partitions p JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.category <> 'lead' AND COALESCE(p.field_type_id, w.default_field_type_id) = ft.id
);
