export type ConversationStatus = "open" | "snoozed" | "closed";
export interface InboxChannel {
    id: number;
    workspaceId: number;
    publicKey: string;
    name: string;
    greeting: string;
    color: string;
    allowedOrigins: string[];
    enabled: boolean;
}
export interface Conversation {
    aiState: "auto" | "human";
    aiHandoffReason: string | null;
    version: number;
    contactId: string | null;
    id: string;
    channelId: number;
    name: string;
    email: string | null;
    pageUrl: string | null;
    status: ConversationStatus;
    assigneeId: string | null;
    recordId: number | null;
    tags: string[];
    priority: boolean;
    preview: string;
    lastMessageAt: string;
    customerSeq: number;
    unread: boolean;
}
export interface ChatMessage {
    attachments: ChatAttachment[];
    id: number;
    clientId: string;
    kind: "customer" | "reply" | "note";
    body: string;
    authorName: string;
    createdAt: string;
}
export interface ChatAttachment {
    id: string;
    fileName: string;
    contentType: string;
    size: number;
}
export interface InboxBootstrap {
    channels: InboxChannel[];
    members: { id: string; name: string }[];
    workspaces: { id: number; name: string }[];
}
export type ConversationFilter =
    | "all"
    | "mine"
    | "unassigned"
    | "unread"
    | "priority";
export interface InboxListPage {
    rows: Conversation[];
    counts: Record<ConversationFilter, number>;
    hasMore: boolean;
}
