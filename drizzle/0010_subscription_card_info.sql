-- Add card_info column to subscriptions for displaying payment method
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "card_info" jsonb;
