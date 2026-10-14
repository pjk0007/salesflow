export type {
    SendbOperationsPolicy as OperationsPolicy,
    SendbOperationsSettings as OperationsSettings,
    SendbNotificationPage as NotificationPage,
    SendbNotification as Notification,
    SendbOperationsReport as OperationsReport,
    SendbConversationOperations as ConversationOperations,
} from "../../../../sdk/support-types";
export type OpenSupportConversation = (value: {
    conversationId: string;
    channelId: number;
    status: "open" | "snoozed" | "closed";
}) => void;
