-- 이메일 클릭 봇 판정 R6 (docs/2026-10-13-email-click-bot-filter/DESIGN.md 4절)
-- 칸 두 개를 더하고 기존 클릭을 ua → early → burst 순서로 채운다. 앞 단계에서 봇이 된 줄은 뒤 단계가 덮어쓰지 않는다.
-- 판정 입력은 UA·발송 시각·같은 발송의 다른 클릭뿐이다. 트래커 표는 보지 않는다.
-- 기준(UA 정규식·15초·10초·이웃 2건)은 src/lib/email-click-bot-rules.ts 상수와 같다 — email-click-bot-sql.test.ts가 이 파일을 읽어 대조한다.
-- is_bot은 상수 기본값이라 PostgreSQL 11 이상에서 표를 다시 쓰지 않는다. 3)의 RANGE 창도 11 이상이 필요하다.
-- ALTER가 잡은 ACCESS EXCLUSIVE는 백필이 끝나 커밋될 때까지 이어진다 (약 3.5만 행, 수 초).
-- 잠금을 5초 안에 못 얻으면 55P03으로 되돌리고 migrate.ts가 다시 시도한다 (0075·0078과 같은 값).
-- 1)~3)은 다시 돌려도 같다 — 배포 순간 옛 인스턴스가 판정 없이 남긴 클릭은 세 UPDATE만 다시 돌려 채운다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "email_click_logs" ADD COLUMN IF NOT EXISTS "is_bot" boolean DEFAULT false NOT NULL;
ALTER TABLE "email_click_logs" ADD COLUMN IF NOT EXISTS "bot_reason" varchar(16);

-- 1) ua: UA가 없거나 공백뿐이거나, 봇 토큰을 담거나, 맨 앞이 mozilla/5.0 chrome/ (대소문자 무시)
UPDATE "email_click_logs" SET "is_bot" = true, "bot_reason" = 'ua'
WHERE "is_bot" = false
  AND ("user_agent" IS NULL
       OR "user_agent" ~ '^[[:space:]]*$'
       OR "user_agent" ~* 'curl|python|node-fetch|ruby|go-http|java/|guard|antispam|linker|scan|bot|spider|preview|headless|wget|okhttp|msie|^mozilla/5[.]0 chrome/');

-- 2) early: 발송 뒤 15초 미만 (음수 포함). 정확히 15초는 사람 쪽
UPDATE "email_click_logs" c SET "is_bot" = true, "bot_reason" = 'early'
FROM "email_send_logs" s
WHERE s."id" = c."send_log_id"
  AND c."is_bot" = false
  AND c."clicked_at" < s."sent_at" + interval '15 seconds';

-- 3) burst: 같은 발송에서 ±10초 안(정각 포함)에 다른 클릭이 2건 이상. 이웃에는 1)·2)에서 봇이 된 클릭도 센다
UPDATE "email_click_logs" c SET "is_bot" = true, "bot_reason" = 'burst'
FROM (
    SELECT "id", count(*) OVER (
        PARTITION BY "send_log_id" ORDER BY "clicked_at"
        RANGE BETWEEN interval '10 seconds' PRECEDING AND interval '10 seconds' FOLLOWING
    ) - 1 AS "neighbors"
    FROM "email_click_logs"
) n
WHERE n."id" = c."id"
  AND c."is_bot" = false
  AND n."neighbors" >= 2;
