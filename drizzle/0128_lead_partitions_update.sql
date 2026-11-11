-- 리드 관리 페이지에 보일 파티션 보정 (2026-11-11 주희님 확인)
-- 번호만 보면 다른 DB에서 엉뚱한 파티션이 바뀔 수 있어 이름까지 같을 때만 바꾼다.
-- 마케터하이어: 56 "일반 DB"는 메일 발송용으로 되돌리고, 57 "상담신청"을 리드로
UPDATE "partitions" SET "category" = 'cold' WHERE "id" = 56 AND "name" = '일반 DB';
UPDATE "partitions" SET "category" = 'lead' WHERE "id" = 57 AND "name" = '상담신청';
-- KSFC 지원사업 폼 파티션
UPDATE "partitions" SET "category" = 'lead' WHERE "id" = 109 AND "name" = '대구 제조데이터 컨설팅 지원사업';
UPDATE "partitions" SET "category" = 'lead' WHERE "id" = 110 AND "name" = '전남형 스마트공장 기초 2차 (전 업종)';
UPDATE "partitions" SET "category" = 'lead' WHERE "id" = 111 AND "name" = '경북형 스마트공장 기초 2차';
UPDATE "partitions" SET "category" = 'lead' WHERE "id" = 112 AND "name" = '김제 농·식품 스마트공장 기초';
