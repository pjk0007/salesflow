-- 리드 댓글(메모): 종류(통화·메일·미팅·문자·기타), 첨부파일, 이 댓글에서 정한 다음 연락일 (2026-11-11 주희님 승인)
ALTER TABLE "memos" ADD COLUMN IF NOT EXISTS "kind" varchar(20);
--> statement-breakpoint
ALTER TABLE "memos" ADD COLUMN IF NOT EXISTS "attachments" jsonb;
--> statement-breakpoint
ALTER TABLE "memos" ADD COLUMN IF NOT EXISTS "next_contact_at" timestamp with time zone;
