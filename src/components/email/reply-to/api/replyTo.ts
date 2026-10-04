/**
 * AI 규칙 화면의 답장 상태 조회 주소 (SWR 키) — GET /api/email/reply-to?partitionId=
 * 규칙 파티션의 워크스페이스 답장 받을 주소와 조직의 발신 주소 전부의 MX를 받는다. 묶음은 넘기지 않는다 —
 * 서버가 주소를 다 주므로 폼에서 묶음을 고쳐도 다시 묻지 않고 화면에서 고른다. 파티션을 아직 고르지 않았으면 null (조회 안 함)
 */
export const REPLY_TO_STATUS_PATH = "/api/email/reply-to";

export function replyToStatusKey(partitionId: number | null | undefined): string | null {
    if (!partitionId) return null;
    return `${REPLY_TO_STATUS_PATH}?partitionId=${partitionId}`;
}
