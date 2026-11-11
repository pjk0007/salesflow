-- 0135에서 '줌'(zoom) 단어로 미팅을 찾다가 '남겨줌'·'알려줌' 같은 말까지 미팅으로 잘못 단 댓글을 바로잡는다.
-- 다른 미팅 단어가 없고 '줌 미팅/줌 회의'도 아닌 경우만 고친다 (2026-11-12)
UPDATE memos m
SET kind = CASE
    WHEN m.content ~* '통화|전화|부재|수신 ?거부|안 ?받|연결 ?안' THEN 'call'
    WHEN m.content ~* '문자|카톡|카카오|알림톡|sms|메시지' THEN 'sms'
    WHEN m.content ~* '메일|e-?mail|회신|견적서 ?발송|자료 ?발송' THEN 'mail'
    ELSE 'etc'
END
FROM records r
JOIN partitions p ON p.id = r.partition_id
WHERE m.record_id = r.id
  AND p.category = 'lead'
  AND m.kind = 'meeting'
  AND m.content ~ '줌'
  AND m.content !~* '미팅|방문|대면|화상|zoom|구글 ?밋|meet|줌 ?(미팅|회의)';
