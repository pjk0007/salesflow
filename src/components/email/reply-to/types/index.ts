import type { MxStatus, SenderMxEntry } from "@/lib/reply-to-rules";

export type { MxStatus, SenderMxEntry };

/**
 * GET /api/email/reply-to 응답 (AI 규칙 화면의 답장 안내, DESIGN-3).
 * senders는 조직의 발신 주소 전부라 화면이 묶음을 고쳐도 다시 묻지 않고 poolSenderEntries로 다시 고른다.
 */
export interface ReplyToStatusResponse {
    /** 조직의 발신 주소 전부와 도메인 MX (설정 발신자는 profileId null) */
    senders: SenderMxEntry[];
    /** 요청의 senderProfileIds 묶음이 실제로 쓸 주소 (화면은 senders로 다시 고른다) */
    pool: SenderMxEntry[];
    /** pool 중 메일을 받지 않는(MX 없음) 도메인 */
    poolNoMxDomains: string[];
}
