-- 조직 멤버의 role이 바뀌면 이 값을 1 증가시켜 기존 JWT를 무효화한다.
-- JWT payload에 발급 시점의 값이 구워지고, 관리자 경로(requireAdmin)에서만 대조한다.
-- users가 아니라 organization_members에 두는 이유: role이 여기 살고,
-- 다중 조직 사용자의 A조직 강등이 B조직 세션을 끊지 않아야 한다.
-- DEFAULT 0 — 도입 이전에 발급된 토큰(tokenVersion 없음)은 0으로 간주되어 그대로 통과한다.

ALTER TABLE "organization_members"
    ADD COLUMN IF NOT EXISTS "token_version" integer DEFAULT 0 NOT NULL;
