-- 폴더도 레코드(cold) / 리드 관리(lead) 페이지를 나눈다. 기존 폴더는 모두 레코드용
ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "category" varchar(20) NOT NULL DEFAULT 'cold';
