BEGIN;
-- 가상 조직 fixture (기대값은 DESIGN 14절)
CREATE TEMP TABLE fx(tag text, sec numeric, ua text);
INSERT INTO fx VALUES
 ('F1',60,NULL),('F1',200,'   '),
 ('F2',60,'curl/8.4.0'),
 ('F3',60,'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36'),
 ('F4',14.999,'CH'),('F5',15.000,'CH'),
 ('F6',100,'CH'),('F6',103,'CH'),('F6',106,'CH'),
 ('F7',100,'CH'),('F7',109,'CH'),('F7',118,'CH'),
 ('F8',100,'CH'),('F8',110,'CH'),('F8',120,'CH'),
 ('F9',100,'curl/8.4.0'),('F9',102,'curl/8.4.0'),('F9',104,'CH'),
 ('F10',2,'curl/8.4.0'),('F10',5,'CH'),('F10',8,'CH'),
 ('F11a',100,'CH'),('F11b',101,'CH'),('F11a',102,'CH'),
 ('F12',300,'CH'),('F12',600,'curl/8.4.0');
UPDATE fx SET ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36' WHERE ua='CH';
CREATE TEMP TABLE fxs AS
 WITH ins AS (INSERT INTO email_send_logs(org_id, recipient_email, status, sent_at, subject)
   SELECT '00000000-0000-0000-0000-00000000b0b0', t||'@fixture.invalid', 'sent', '2026-09-01 10:00:00+09', t
   FROM (SELECT DISTINCT tag t FROM fx) d RETURNING id, subject)
 SELECT id, subject tag FROM ins;
INSERT INTO email_click_logs(org_id, send_log_id, url, clicked_at, user_agent)
 SELECT '00000000-0000-0000-0000-00000000b0b0', s.id, 'https://x.invalid', '2026-09-01 10:00:00+09'::timestamptz + fx.sec*interval '1 second', fx.ua
 FROM fx JOIN fxs s ON s.tag=fx.tag;
\i /Users/jaehun/Projects/salesflow/drizzle/0080_email_click_bot.sql
SELECT s.tag, extract(epoch from c.clicked_at - timestamptz '2026-09-01 10:00:00+09') sec, c.is_bot, c.bot_reason
 FROM email_click_logs c JOIN fxs s ON s.id=c.send_log_id ORDER BY s.tag, sec;
-- 기존 로컬 클릭 분포 (참고)
SELECT coalesce(bot_reason,'human') r, count(*) FROM email_click_logs WHERE org_id<>'00000000-0000-0000-0000-00000000b0b0' GROUP BY 1 ORDER BY 2 DESC;
\d email_click_logs
ROLLBACK;
