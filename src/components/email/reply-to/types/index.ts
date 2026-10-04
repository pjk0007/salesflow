import type { MxStatus, SenderMxEntry } from "@/lib/reply-to-rules";

export type { MxStatus, SenderMxEntry };

/**
 * GET /api/email/reply-to?partitionId= 응답 (AI 규칙 화면의 답장 안내, DESIGN-3 3절).
 * senders는 조직의 발신 주소 전부라 화면이 묶음을 고쳐도 다시 묻지 않고 poolSenderEntries로 다시 고른다.
 */
export interface ReplyToStatusResponse {
    /** 규칙 파티션의 워크스페이스와 답장 받을 주소·그 도메인의 MX. 파티션을 넘기지 않았으면 null */
    workspace: { id: number; name: string; replyToEmail: string | null; replyToMx: MxStatus | null } | null;
    /** 조직의 발신 주소 전부와 도메인 MX (설정 발신자는 profileId null) */
    senders: SenderMxEntry[];
    /** 요청의 senderProfileIds 묶음이 실제로 쓸 주소 (화면은 senders로 다시 고른다) */
    pool: SenderMxEntry[];
    /** 답장 주소가 비어 있을 때 pool 중 MX가 없는 도메인 */
    poolNoMxDomains: string[];
}
