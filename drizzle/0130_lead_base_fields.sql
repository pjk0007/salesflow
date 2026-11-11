-- 리드 파티션이 쓰는 속성 타입에 리드 기본 칸(기업명·담당자·대응상태·연락처·이메일·요청사항·유입경로)이 없으면 채운다.
-- 같은 뜻의 칸(key나 라벨)이 하나라도 있으면 건드리지 않는다. src/lib/leads/base-fields.ts 와 같은 규칙.
-- 이어서 대응상태가 비어 있는 기존 리드는 '신규'로 둔다.
DO $$
DECLARE
    ft integer;
    next_order integer;
BEGIN
    FOR ft IN
        SELECT DISTINCT COALESCE(p.field_type_id, w.default_field_type_id)
        FROM partitions p
        JOIN workspaces w ON w.id = p.workspace_id
        WHERE p.category = 'lead' AND COALESCE(p.field_type_id, w.default_field_type_id) IS NOT NULL
    LOOP
        SELECT COALESCE(MAX(sort_order), 0) INTO next_order FROM field_definitions WHERE field_type_id = ft;

        IF NOT EXISTS (SELECT 1 FROM field_definitions WHERE field_type_id = ft AND key IN ('companyName', 'companyname')) THEN
            next_order := next_order + 1;
            INSERT INTO field_definitions (field_type_id, key, label, field_type, sort_order)
            VALUES (ft, 'companyName', '기업명', 'text', next_order);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM field_definitions WHERE field_type_id = ft AND key IN ('contactName', 'name')) THEN
            next_order := next_order + 1;
            INSERT INTO field_definitions (field_type_id, key, label, field_type, sort_order)
            VALUES (ft, 'name', '담당자', 'text', next_order);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM field_definitions WHERE field_type_id = ft AND key = 'status') THEN
            next_order := next_order + 1;
            INSERT INTO field_definitions (field_type_id, key, label, field_type, sort_order, options, option_colors, track_history, is_groupable)
            VALUES (ft, 'status', '대응상태', 'select', next_order,
                '["신규", "부재", "연락 중", "핵심", "종료", "전환"]'::jsonb,
                '{"신규": "#3b82f6", "부재": "#9ca3af", "연락 중": "#f59e0b", "핵심": "#f97316", "종료": "#9ca3af", "전환": "#8b5cf6"}'::jsonb,
                1, 1);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM field_definitions WHERE field_type_id = ft AND key IN ('phone', 'contact')) THEN
            next_order := next_order + 1;
            INSERT INTO field_definitions (field_type_id, key, label, field_type, sort_order)
            VALUES (ft, 'phone', '연락처', 'phone', next_order);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM field_definitions WHERE field_type_id = ft AND key = 'email') THEN
            next_order := next_order + 1;
            INSERT INTO field_definitions (field_type_id, key, label, field_type, sort_order)
            VALUES (ft, 'email', '이메일', 'email', next_order);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM field_definitions WHERE field_type_id = ft
                       AND (key IN ('note', 'memo') OR trim(label) IN ('요청사항', '문의 내용', '문의내용'))) THEN
            next_order := next_order + 1;
            INSERT INTO field_definitions (field_type_id, key, label, field_type, sort_order)
            VALUES (ft, 'note', '요청사항', 'textarea', next_order);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM field_definitions WHERE field_type_id = ft AND key = 'source') THEN
            next_order := next_order + 1;
            INSERT INTO field_definitions (field_type_id, key, label, field_type, sort_order)
            VALUES (ft, 'source', '유입경로', 'text', next_order);
        END IF;
    END LOOP;
END $$;
--> statement-breakpoint
UPDATE records r
SET data = r.data || '{"status": "신규"}'::jsonb
FROM partitions p
WHERE p.id = r.partition_id
  AND p.category = 'lead'
  AND COALESCE(r.data->>'status', '') = '';
