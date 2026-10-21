-- 화면 검증용 데모 fixture (조직 D, 120일, 하루 300통, 결정적: hashint4)
\set ON_ERROR_STOP on
INSERT INTO organizations(id,name,slug) VALUES('00000000-0000-4000-8000-0000000000d1','Dash Demo','dash-demo');
INSERT INTO workspaces(id,org_id,name) VALUES (9101,'00000000-0000-4000-8000-0000000000d1','오피오'),(9102,'00000000-0000-4000-8000-0000000000d1','백오피스랩');
INSERT INTO partitions(id,workspace_id,name) VALUES (9201,9101,'G1'),(9202,9101,'G2'),(9203,9102,'T1-페인'),(9204,9102,'T3-일반');
INSERT INTO email_templates(id,org_id,name,subject,html_body) VALUES (9301,'00000000-0000-4000-8000-0000000000d1','재택 안내','s','b'),(9302,'00000000-0000-4000-8000-0000000000d1','업무 대행','s','b');
INSERT INTO email_template_links(id,partition_id,name,email_template_id,recipient_field) VALUES (9401,9201,'G1 재택 1차',9301,'email'),(9402,9203,'T1 페인 연결',9302,'email');
INSERT INTO email_auto_personalized_links(id,org_id,name,partition_id,recipient_field,company_field) VALUES
 (9501,'00000000-0000-4000-8000-0000000000d1','[오피오] 재택근무 채용 기업',9202,'email','company'),
 (9502,'00000000-0000-4000-8000-0000000000d1','[백오피스랩] T3-일반',9204,'email','company');
INSERT INTO records(org_id,workspace_id,partition_id,created_at)
SELECT '00000000-0000-4000-8000-0000000000d1', CASE WHEN g%2=0 THEN 9101 ELSE 9102 END, 9201+(g%4), now()-((g%120)||' days')::interval - ((g%86400)||' seconds')::interval FROM generate_series(1,6000) g;
-- 첫 메일
CREATE TEMP TABLE f AS
SELECT g, (abs(hashint4(g))%1000) h, now()-((g/300)||' days')::interval - ((g%300)*100||' seconds')::interval sent_at FROM generate_series(0,36000-1) g;
INSERT INTO email_send_logs(org_id,partition_id,recipient_email,subject,status,trigger_type,sent_at,auto_personalized_link_id,template_link_id,email_template_id,sender_email,request_id,nhn_status_code,open_tracked)
SELECT '00000000-0000-4000-8000-0000000000d1',
  CASE WHEN h<350 THEN 9202 WHEN h<550 THEN 9204 WHEN h<800 THEN 9201 ELSE 9203 END,
  'd'||g||'@example.invalid','데모 '||g,
  CASE WHEN h<930 THEN 'sent' WHEN h<975 THEN 'failed' WHEN h<985 THEN 'pending' ELSE 'cancelled' END,
  CASE WHEN h<550 THEN 'ai_auto' WHEN h<800 THEN 'auto' WHEN h<900 THEN 'manual' ELSE 'repeat' END,
  sent_at,
  CASE WHEN h<350 THEN 9501 WHEN h<550 THEN 9502 END,
  CASE WHEN h>=550 AND h<800 THEN 9401 WHEN h>=800 THEN 9402 END,
  CASE WHEN h>=550 AND h<800 THEN 9301 WHEN h>=800 THEN 9302 END,
  CASE WHEN h%3=0 THEN 'kim@opio.example' WHEN h%3=1 THEN 'lee@opio.example' ELSE 'park@bol.example' END,
  'req-'||g,
  CASE WHEN sent_at > now()-interval '2 days' THEN NULL WHEN h<900 THEN 'SST2' WHEN h<930 THEN 'SST3' WHEN h<935 THEN 'SST5' ELSE NULL END,
  sent_at > now()-interval '30 days'
FROM f ORDER BY sent_at;
-- 후속 25% (부모 5일 뒤, 지금보다 과거만)
INSERT INTO email_send_logs(org_id,partition_id,recipient_email,subject,status,trigger_type,sent_at,parent_log_id,sender_email,request_id,nhn_status_code,open_tracked)
SELECT l.org_id,l.partition_id,l.recipient_email,'Re: '||l.subject,'sent','followup',l.sent_at+interval '5 days',l.id,l.sender_email,'req-f-'||l.id,
  CASE WHEN l.sent_at+interval '5 days' > now()-interval '2 days' THEN NULL ELSE 'SST2' END, l.sent_at+interval '5 days' > now()-interval '30 days'
FROM email_send_logs l WHERE l.org_id='00000000-0000-4000-8000-0000000000d1' AND l.parent_log_id IS NULL AND l.status='sent' AND abs(hashint4(l.id))%4=0 AND l.sent_at+interval '5 days' < now()
ORDER BY l.sent_at+interval '5 days';
-- 오픈(추적 발송의 22%, 그중 30% 기계), 클릭 3%(10% 봇), 사람 회신(첫 메일 2%), 수신거부 0.3%
INSERT INTO email_open_logs(org_id,send_log_id,is_machine,machine_reason,opened_at)
SELECT org_id,id,abs(hashint4(id+7))%10<3,CASE WHEN abs(hashint4(id+7))%10<3 THEN 'early' END,sent_at+interval '2 hours' FROM email_send_logs
WHERE org_id='00000000-0000-4000-8000-0000000000d1' AND open_tracked AND status='sent' AND abs(hashint4(id+3))%100<22 AND sent_at+interval '2 hours'<now();
INSERT INTO email_click_logs(org_id,send_log_id,url,is_bot,click_id,clicked_at)
SELECT org_id,id,'https://example.invalid',abs(hashint4(id+11))%10=0,'demo-'||id,sent_at+interval '3 hours' FROM email_send_logs
WHERE org_id='00000000-0000-4000-8000-0000000000d1' AND status='sent' AND abs(hashint4(id+5))%100<3 AND sent_at+interval '3 hours'<now();
INSERT INTO email_replies(org_id,send_log_id,root_log_id,mailbox,gmail_message_id,from_email,to_email,contact_email,kind,ours_reason,match_status,received_at,detected_mode)
SELECT org_id,id,id,'demo@example.invalid','demo-'||id,recipient_email,'demo@example.invalid',recipient_email,'human','address','matched',sent_at+interval '1 day','dry_run' FROM email_send_logs
WHERE org_id='00000000-0000-4000-8000-0000000000d1' AND parent_log_id IS NULL AND status='sent' AND abs(hashint4(id+13))%100<2 AND sent_at+interval '1 day'<now();
INSERT INTO email_unsubscribes(org_id,workspace_id,email,send_log_id,source)
SELECT l.org_id,p.workspace_id,l.recipient_email,l.id,'link' FROM email_send_logs l JOIN partitions p ON p.id=l.partition_id
WHERE l.org_id='00000000-0000-4000-8000-0000000000d1' AND l.status='sent' AND abs(hashint4(l.id+17))%1000<3;
ANALYZE;
SELECT count(*) sends, count(*) FILTER (WHERE parent_log_id IS NOT NULL) followups FROM email_send_logs;
