-- 트래커 사이트에 "전환 완료 단계명" 추가
-- 디하=구독중, 백오피스랩=종료 등 사이트별로 결제/계약 완료를 의미하는 record 단계명.
-- 트래커 개요 깔때기에 "결제" 단계로 표시. NULL이면 깔때기 4단 미표시 (3단까지만).
ALTER TABLE "tracker_sites" ADD COLUMN IF NOT EXISTS "conversion_stage" varchar(100);
