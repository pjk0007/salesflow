import type { SendbCustomerConversationPage } from "../../../../sdk/messenger";

export type CustomerConversationPage = SendbCustomerConversationPage;
export type CustomerConversationRow = CustomerConversationPage["rows"][number];
export type CustomerConversationView = "current" | "thread" | "new" | "list";
export type CustomerReadAck = {
    lastMessageId: number;
    readRevision: number;
    unread: number;
};
export type CustomerConversationState = {
    view: CustomerConversationView;
    conversationId?: string;
    rows: CustomerConversationRow[];
    unreadCount?: number;
    hasMore: boolean;
    loading: boolean;
    error?: Error;
};
