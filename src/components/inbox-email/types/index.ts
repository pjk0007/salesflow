export interface EmailMailbox {
    connectionStatus?: string | null;
    connectionErrorCode?: string | null;
    workerEnabled?: boolean;
    /** 이 주소를 로그인 계정으로 쓰는 다른 사업 메일함 수 */
    aliasMailboxCount?: number;
    googleAccount?: string | null;
    id: string;
    workspaceId: number;
    address: string;
    name: string;
    enabled: boolean;
    version: number;
}
export interface GoogleConnectionStatus {
    configured: boolean;
    workerEnabled: boolean;
    connection: {
        status: string;
        version: number;
        lastPollAt?: string | null;
        lastProcessedAt?: string | null;
        errorCode?: string | null;
    };
    counts: { pending: number; failed: number; done: number };
    failedReasons?: { reasonCode: string | null; count: number }[];
    /** 중지·재연결·해제 때 취소되는 발송 대기 답장 수 */
    pendingReplies?: number;
}
export type GoogleConnectionAction =
    | { action: "connect"; version: number; lookbackDays: number }
    | { action: "disconnect"; version: number }
    | { action: "retry" };
export interface EmailDelivery {
    id: string;
    state:
        | "queued"
        | "leased"
        | "sending"
        | "sent"
        | "failed"
        | "uncertain"
        | "cancelled";
    recipient: string;
    recipientTo?: string[];
    recipientCc?: string[];
    replyMode?: string;
    sourceMessageId?: number | null;
    sentAt: string | null;
    errorCode: string | null;
}
