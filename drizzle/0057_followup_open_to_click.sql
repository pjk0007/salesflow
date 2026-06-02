-- 후속 메일 분기 기준을 수신확인(open) → 링크 클릭(click)으로 전환.
-- followup_config JSONB 키 rename: onOpened→onClicked, onNotOpened→onNotClicked.
-- email_followup_queue.result 값 변환: opened→clicked, not_opened→not_clicked.

-- 1) ai links / template links 의 followup_config (배열 형태) 각 step 키 rename
--    배열 각 원소에서 onOpened/onNotOpened 키를 새 키로 옮김.
CREATE OR REPLACE FUNCTION pg_temp.rename_followup_keys(cfg jsonb) RETURNS jsonb AS $$
    SELECT jsonb_agg(
        (step - 'onOpened' - 'onNotOpened')
        || CASE WHEN step ? 'onOpened' THEN jsonb_build_object('onClicked', step->'onOpened') ELSE '{}'::jsonb END
        || CASE WHEN step ? 'onNotOpened' THEN jsonb_build_object('onNotClicked', step->'onNotOpened') ELSE '{}'::jsonb END
    )
    FROM jsonb_array_elements(cfg) AS step;
$$ LANGUAGE sql IMMUTABLE;

UPDATE email_auto_personalized_links
SET followup_config = pg_temp.rename_followup_keys(followup_config)
WHERE followup_config IS NOT NULL AND jsonb_typeof(followup_config) = 'array';

UPDATE email_template_links
SET followup_config = pg_temp.rename_followup_keys(followup_config)
WHERE followup_config IS NOT NULL AND jsonb_typeof(followup_config) = 'array';

-- 2) 큐 처리 결과 값 변환
UPDATE email_followup_queue SET result = 'clicked' WHERE result = 'opened';
UPDATE email_followup_queue SET result = 'not_clicked' WHERE result = 'not_opened';
