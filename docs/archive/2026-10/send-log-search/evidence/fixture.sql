-- S3·S4·S6 fixture: 조직 A(…a1), 조직 B(…b1)
INSERT INTO organizations (id,name,slug) VALUES
 ('00000000-0000-4000-8000-0000000000a1','Search A','search-a'),
 ('00000000-0000-4000-8000-0000000000b1','Search B','search-b');
INSERT INTO email_send_logs (org_id,recipient_email,subject,status,sent_at,trigger_type) VALUES
 ('00000000-0000-4000-8000-0000000000a1','info@inzent.com','A1 정확','sent',now()-interval '3 hours','auto'),
 ('00000000-0000-4000-8000-0000000000a1','Info@Inzent.COM','A2 대문자','sent',now()-interval '2 hours','auto'),
 ('00000000-0000-4000-8000-0000000000a1','inzent@inzent.com','A3 같은 도메인 다른 주소','sent',now()-interval '1 hours','auto'),
 ('00000000-0000-4000-8000-0000000000a1','other@example.invalid','A4 제목에 info@inzent.com 포함','sent',now()-interval '1 hours','auto'),
 ('00000000-0000-4000-8000-0000000000a1','xinfo@inzent.com','A5 접두 다름','sent',now()-interval '1 hours','auto'),
 ('00000000-0000-4000-8000-0000000000b1','info@inzent.com','B1 다른 조직','sent',now()-interval '1 hours','auto');
INSERT INTO alimtalk_send_logs (org_id,sender_key,template_code,recipient_no,template_name,status,sent_at) VALUES
 ('00000000-0000-4000-8000-0000000000a1','fixture','fixture','01000000000','알림 info@inzent.com','sent',now()-interval '1 hours');
-- S5 성능: 조직 A에 30만 행(본문 약 1.2KB)
INSERT INTO email_send_logs (org_id,recipient_email,subject,body,status,sent_at,trigger_type)
SELECT '00000000-0000-4000-8000-0000000000a1','u'||g||'@d'||(g%5000)||'.example.invalid','perf '||g,repeat(md5(g::text),38),'sent',now()-(g||' minutes')::interval,'auto'
FROM generate_series(1,300000) g;
ANALYZE email_send_logs;
