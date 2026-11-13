-- 직원이 이미 답한 상담인데 담당자가 비어 있으면, 마지막으로 답한 직원을 담당자로 둔다 (과거 이관 이력 제외)
UPDATE "inbox_conversations" c
SET "assignee_id" = last."author_id"
FROM (
    SELECT DISTINCT ON (m."conversation_id") m."conversation_id", m."author_id"
    FROM "inbox_messages" m
    JOIN "users" u ON u."id" = m."author_id"
    WHERE m."kind" = 'reply' AND m."author_id" IS NOT NULL
    ORDER BY m."conversation_id", m."id" DESC
) last
WHERE c."id" = last."conversation_id"
  AND c."assignee_id" IS NULL
  AND c."history_only" = false;
