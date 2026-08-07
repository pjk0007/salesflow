-- 웹폼이 연결된 파티션의 필드타입에 유입 출처 컬럼(캠페인/광고 소재)을 추가한다.
--
-- 폼 제출 시 sendb_cid·utm_*로 캠페인 출처를 records.data에 기록하지만,
-- 필드 정의가 없으면 데이터가 쌓여도 화면에 컬럼이 뜨지 않는다.
-- 이미 같은 key를 가진 필드타입은 건너뛴다 (멱등).

INSERT INTO field_definitions
    (workspace_id, key, label, field_type, category, sort_order,
     is_required, is_system, default_width, min_width,
     cell_type, cell_class_name, options, is_sortable, field_type_id)
SELECT
    NULL,
    v.key,
    v.label,
    'text',
    NULL,
    COALESCE((SELECT max(fd.sort_order) FROM field_definitions fd WHERE fd.field_type_id = t.ft_id), 0) + v.sort_offset,
    0,
    0,
    v.width,
    80,
    NULL,
    NULL,
    NULL,
    0,
    t.ft_id
FROM (
    SELECT DISTINCT COALESCE(p.field_type_id, w.default_field_type_id) AS ft_id
    FROM web_forms f
    JOIN partitions p ON p.id = f.partition_id
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE f.is_active = 1
      AND COALESCE(p.field_type_id, w.default_field_type_id) IS NOT NULL
) t
CROSS JOIN (
    VALUES ('campaignName', '캠페인', 1, 140),
           ('adName', '광고 소재', 2, 240)
) AS v(key, label, sort_offset, width)
WHERE NOT EXISTS (
    SELECT 1 FROM field_definitions fd
    WHERE fd.field_type_id = t.ft_id AND fd.key = v.key
);
