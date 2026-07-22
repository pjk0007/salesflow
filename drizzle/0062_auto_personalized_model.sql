-- AI 자동발송 규칙의 AI 모델 선택.
-- 첫 메일과 팔로우업(후속 메일)이 같은 모델을 공유한다. null이면 기본 모델(gemini-3.5-flash-lite).

ALTER TABLE "email_auto_personalized_links"
    ADD COLUMN IF NOT EXISTS "model" varchar(100);
