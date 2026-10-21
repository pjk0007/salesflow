-- 17-3 집계 fixture (조직 e2, 오늘 날짜, trigger auto). DESIGN 17-3 표 S1~S8
INSERT INTO organizations (id,name,slug) VALUES ('00000000-0000-4000-8000-0000000000e2','Open agg fixture','open-agg-fixture');
INSERT INTO email_send_logs (org_id,recipient_email,status,sent_at,open_tracked,trigger_type)
SELECT '00000000-0000-4000-8000-0000000000e2','s'||n||'@example.invalid',st,now()-interval '2 hours',tr,'auto'
FROM (VALUES (1,'sent',true),(2,'sent',true),(3,'sent',true),(4,'sent',true),(5,'sent',true),(6,'sent',false),(7,'failed',true),(8,'sent',true)) v(n,st,tr) ORDER BY n;
CREATE TEMP VIEW s AS SELECT id, split_part(split_part(recipient_email,'@',1),'s',2)::int AS n FROM email_send_logs WHERE org_id='00000000-0000-4000-8000-0000000000e2';
INSERT INTO email_open_logs (org_id,send_log_id,is_machine,machine_reason) SELECT '00000000-0000-4000-8000-0000000000e2',id,true,'early' FROM s WHERE n=2;
INSERT INTO email_open_logs (org_id,send_log_id,is_machine) SELECT '00000000-0000-4000-8000-0000000000e2',id,false FROM s WHERE n IN (3,7,8);
INSERT INTO email_open_logs (org_id,send_log_id,is_machine) SELECT '00000000-0000-4000-8000-0000000000e2',id,false FROM s WHERE n=8;
INSERT INTO email_click_logs (org_id,send_log_id,url,is_bot) SELECT '00000000-0000-4000-8000-0000000000e2',id,'https://example.invalid',false FROM s WHERE n IN (4,6,8);
INSERT INTO email_click_logs (org_id,send_log_id,url,is_bot) SELECT '00000000-0000-4000-8000-0000000000e2',id,'https://example.invalid',true FROM s WHERE n=5;
SELECT n,id FROM s ORDER BY n;
