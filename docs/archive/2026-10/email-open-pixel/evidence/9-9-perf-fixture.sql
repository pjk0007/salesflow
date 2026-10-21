-- 9-9 성능 관문 fixture: 한 조직, 90일, 발송 30만(1/3 open_tracked), 대상의 5%에 오픈 1~3(30% 기계), 전체 2%에 클릭(10% 봇)
SET session_replication_role = replica;  -- FK 트리거 생략(빠른 적재). 값은 일관되게 만든다
INSERT INTO organizations (id,name,slug) VALUES ('00000000-0000-4000-8000-0000000000a9','perf','perf');
INSERT INTO workspaces (id,org_id,name) VALUES (9001,'00000000-0000-4000-8000-0000000000a9','ws') ;
INSERT INTO partitions (id,workspace_id,name) VALUES (9001,9001,'p');
INSERT INTO email_templates (id,org_id,name,subject,html_body) VALUES (9001,'00000000-0000-4000-8000-0000000000a9','t','s','b');
INSERT INTO email_template_links (id,partition_id,name,email_template_id,recipient_field)
SELECT 9000+g,9001,'연결'||g,9001,'email' FROM generate_series(1,20) g;
INSERT INTO email_send_logs (org_id,partition_id,recipient_email,status,sent_at,open_tracked,trigger_type,template_link_id)
SELECT '00000000-0000-4000-8000-0000000000a9',9001,'r'||g||'@example.invalid',
       CASE WHEN g%25=0 THEN 'failed' ELSE 'sent' END,
       now() - (g % 90) * interval '1 day' - (g % 86400) * interval '1 second',
       g%3=0,
       (ARRAY['auto','ai_auto','followup','manual'])[1+g%4],
       CASE WHEN g%4=0 THEN 9001+g%20 END
FROM generate_series(1,300000) g;
INSERT INTO email_open_logs (org_id,send_log_id,opened_at,is_machine,machine_reason)
SELECT s.org_id, s.id, s.sent_at + interval '5 minutes', (k=1 AND s.id%10<3), CASE WHEN k=1 AND s.id%10<3 THEN 'early' END
FROM email_send_logs s CROSS JOIN LATERAL generate_series(1, 1 + s.id%3) k
WHERE s.org_id='00000000-0000-4000-8000-0000000000a9' AND s.open_tracked AND s.id%20=0;
INSERT INTO email_click_logs (org_id,send_log_id,url,is_bot)
SELECT org_id,id,'https://example.invalid',id%10=0 FROM email_send_logs WHERE org_id='00000000-0000-4000-8000-0000000000a9' AND id%50=7;
SET session_replication_role = origin;
ANALYZE email_send_logs; ANALYZE email_open_logs; ANALYZE email_click_logs;
SELECT (SELECT count(*) FROM email_send_logs) sends, (SELECT count(*) FROM email_open_logs) opens, (SELECT count(*) FROM email_click_logs) clicks;
