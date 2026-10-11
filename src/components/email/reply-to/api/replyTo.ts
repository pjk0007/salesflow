/**
 * AI 규칙 화면의 답장 안내 조회 주소 (SWR 키) — GET /api/email/reply-to
 * 조직의 발신 주소 전부와 도메인 MX를 받는다. 묶음은 넘기지 않는다 — 서버가 주소를 다 주므로
 * 폼에서 묶음을 고쳐도 다시 묻지 않고 화면에서 고른다. 파티션과 상관없다 (답장은 보낸 주소로 간다)
 */
export const REPLY_TO_STATUS_KEY = "/api/email/reply-to";
