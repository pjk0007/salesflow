export interface SendbReplyGuardContext {
    leaseId: string;
    sessionId: string;
    revision: number;
}
export interface SendbReplyGuardPage {
    enabled: boolean;
    version: number;
    canManage: boolean;
    serverTime: string;
    conversation: {
        revision: number;
        lease: {
            id: string;
            userId: string;
            name: string;
            isMine: boolean;
            baseRevision: number;
            expiresAt: string;
        } | null;
    } | null;
}
export type SendbReplyLeaseInput = {
    conversationId: string;
    sessionId: string;
} & (
    | {
          action: "acquire";
          revision: number;
          takeover?: { leaseId: string; reason: string };
      }
    | { action: "renew" | "release"; leaseId: string }
    | { action: "acknowledge"; leaseId: string; revision: number }
);
