-- 리드 관리 파티션의 예전 댓글(종류 없음)에 종류 태그를 단다 (2026-11-11 주희님 요청).
-- 내용의 단어로 정한다: 미팅·방문 → meeting, 통화·전화·부재 → call, 문자·카톡 → sms, 메일·회신 → mail, 나머지 etc.
-- 이미 종류가 있는 댓글은 건드리지 않는다. 화면에서 고쳐 쓸 수 있다.
UPDATE memos m
SET kind = CASE
    WHEN m.content ~* '미팅|방문|대면|화상|줌|zoom|구글 ?밋|meet' THEN 'meeting'
    WHEN m.content ~* '통화|전화|부재|수신 ?거부|안 ?받|연결 ?안' THEN 'call'
    WHEN m.content ~* '문자|카톡|카카오|알림톡|sms|메시지' THEN 'sms'
    WHEN m.content ~* '메일|e-?mail|회신|견적서 ?발송|자료 ?발송' THEN 'mail'
    ELSE 'etc'
END
FROM records r
JOIN partitions p ON p.id = r.partition_id
WHERE m.record_id = r.id
  AND p.category = 'lead'
  AND m.kind IS NULL;
