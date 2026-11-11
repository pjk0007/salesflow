-- 리드 관리 파티션은 레코드(콜드)와 속성 타입을 따로 쓴다 (2026-11-11 주희님 결정).
-- 리드 파티션이 콜드 파티션과 같은 속성 타입을 쓰고 있으면, 워크스페이스별 "<워크스페이스> 리드" 타입을 만들어
-- 원래 타입의 칸을 복사(쿠폰만료일 CouponExpiration 제외)하고 리드 파티션만 새 타입으로 옮긴다.
-- 레코드 데이터는 건드리지 않는다. 콜드 파티션과 원래 타입은 그대로.
-- src/lib/leads/lead-field-type.ts 와 같은 규칙.
DO $$
DECLARE
    p record;
    target_id integer;
    type_name text;
BEGIN
    FOR p IN
        SELECT lp.id, lp.workspace_id, w.org_id, w.name AS ws_name,
               COALESCE(lp.field_type_id, w.default_field_type_id) AS source_type
        FROM partitions lp
        JOIN workspaces w ON w.id = lp.workspace_id
        WHERE lp.category = 'lead'
          AND COALESCE(lp.field_type_id, w.default_field_type_id) IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM partitions cp
              JOIN workspaces cw ON cw.id = cp.workspace_id
              WHERE cp.category <> 'lead'
                AND COALESCE(cp.field_type_id, cw.default_field_type_id) = COALESCE(lp.field_type_id, w.default_field_type_id)
          )
        ORDER BY lp.id
    LOOP
        type_name := left(p.ws_name || ' 리드', 100);
        SELECT id INTO target_id FROM field_types WHERE org_id = p.org_id AND name = type_name;
        IF target_id IS NULL THEN
            INSERT INTO field_types (org_id, name, description)
            VALUES (p.org_id, type_name, '리드 관리 전용 속성 타입 — 레코드(콜드)와 분리')
            RETURNING id INTO target_id;
        END IF;

        INSERT INTO field_definitions (
            workspace_id, key, label, field_type, category, sort_order, is_required, is_system, default_width, min_width,
            cell_type, cell_class_name, options, status_option_category_id, formula_config, is_sortable, field_type_id,
            default_value, option_colors, option_style, is_groupable, system_column, track_history
        )
        SELECT NULL, f.key, f.label, f.field_type, f.category, f.sort_order, f.is_required, f.is_system, f.default_width, f.min_width,
               f.cell_type, f.cell_class_name, f.options, f.status_option_category_id, f.formula_config, f.is_sortable, target_id,
               f.default_value, f.option_colors, f.option_style, f.is_groupable, f.system_column, f.track_history
        FROM field_definitions f
        WHERE f.field_type_id = p.source_type
          AND f.key <> 'CouponExpiration'
          AND NOT EXISTS (SELECT 1 FROM field_definitions t WHERE t.field_type_id = target_id AND t.key = f.key);

        UPDATE partitions SET field_type_id = target_id, updated_at = now() WHERE id = p.id;
    END LOOP;
END $$;
