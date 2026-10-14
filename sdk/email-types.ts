export interface SendbEmailMailbox {
    id: string;
    workspaceId: number;
    address: string;
    name: string;
    enabled: boolean;
    version: number;
}
export interface SendbInboundEmail {
    providerMessageId: string;
    providerThreadId: string;
    rfcMessageId: string;
    from: string;
    fromName?: string;
    to: string[];
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
