-- 워크스페이스 '제조'를 '설비지원몰'로 (2026-11-11 주희님 요청). 번호+이름이 같을 때만
UPDATE "workspaces" SET "name" = '설비지원몰', "updated_at" = now() WHERE "id" = 21 AND "name" = '제조';
