import type { EmailDelivery } from "@/components/inbox-email/types";
import type { RoutingTeam } from "@/components/inbox-routing/types";
import type { SendbEmailContext } from "../../../../sdk/email-types";
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
    replyGuardEnabled?: boolean;
}
export interface Conversation {
    teamId?: string | null;
    medium?: "web" | "email";
    emailContext?: SendbEmailContext;
    historyOnly?: boolean;
    importMetadata?: Record<string, unknown> | null;
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
    replyRevision: number;
    unread: boolean;
}
export interface ChatMessage {
    mentions?: { userId: string; name: string }[];
    email?: {
        from: string;
        to: string[];
        cc: string[];
        replyTo?: string[];
        subject: string;
        receivedAt: string;
        files: {
            id?: string;
            name: string;
            state?: string;
            errorCode?: string | null;
        }[];
    };
    delivery?: EmailDelivery;
    importMetadata?: {
        sourceId?: string;
        files?: Record<string, unknown>[];
    } | null;
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
    teams?: RoutingTeam[];
    mentionMembers?: { id: string; name: string; workspaceIds: number[] }[];
    channels: InboxChannel[];
    members: { id: string; name: string; workspaceIds: number[] }[];
    workspaces: {
        id: number;
        name: string;
        role: "none" | "viewer" | "agent" | "manager";
        abilities: { read: boolean; respond: boolean; manage: boolean };
    }[];
    canManageAccess: boolean;
}
export type ConversationFilter =
    | "all"
    | "mine"
    | "unassigned"
    | "unread"
    | "priority"
    | "history"
    | "mentioned"
    | "myTeams";
export interface InboxListPage {
    rows: Conversation[];
    counts: Record<ConversationFilter, number>;
    hasMore: boolean;
}
