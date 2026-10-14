export interface SendbEmailMailbox {
    id: string;
    workspaceId: number;
    address: string;
    name: string;
    enabled: boolean;
    version: number;
}
export interface SendbEmailFile {
    id: string;
    receiptId: string;
    fileIndex: number;
    attachmentId: string | null;
    state: "pending" | "available" | "failed" | "blocked";
    errorCode: string | null;
    name: string;
    size: number;
    contentType: string;
    providerId: string;
    providerMessageId: string;
}
export interface SendbInboundEmail {
    providerMessageId: string;
    providerThreadId: string;
    rfcMessageId: string;
    from: string;
    fromName?: string;
    to: string[];
    deliveredTo?: string[];
    cc?: string[];
    subject: string;
    body: string;
    receivedAt: string;
    autoSubmitted?: string;
    precedence?: string;
    files?: {
        name: string;
        size: number;
        contentType: string;
        providerId: string;
    }[];
}
export interface SendbEmailClaim {
    attachments?: {
        id: string;
        fileName: string;
        contentType: string;
        size: number;
        sha256: string;
    }[];
    id: string;
    mailboxId: string;
    messageId: number;
    leaseToken: string;
    leaseUntil: string;
    recipient: string;
    subject: string;
    providerThreadId: string;
    rfcMessageId: string;
    inReplyTo: string;
    from: string;
    fromName: string;
    body: string;
    authorName: string;
}
export type SendbEmailDeliveryAction =
    | {
          action: "prepare_failed";
          leaseToken: string;
          errorCode:
              | "attachment_download"
              | "attachment_changed"
              | "mime_invalid"
              | "mailbox_mismatch";
      }
    | { action: "begin"; leaseToken: string }
    | { action: "sent"; leaseToken: string; providerMessageId: string }
    | {
          action: "failed" | "uncertain";
          leaseToken: string;
          errorCode:
              | "provider_rejected"
              | "auth"
              | "scope"
              | "rate_limited"
              | "network_unknown"
              | "provider_unknown";
      }
    | { action: "retry" | "cancel" };
