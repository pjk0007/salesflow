-- 상담 보류 끝나는 시각 (상담톡 보류 메뉴: 4시간·내일 오전·사용자 지정 등). 지나면 진행중으로 되돌린다
ALTER TABLE "inbox_conversations" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_conversations_snoozed_until" ON "inbox_conversations" ("snoozed_until") WHERE "status" = 'snoozed' AND "snoozed_until" IS NOT NULL;
