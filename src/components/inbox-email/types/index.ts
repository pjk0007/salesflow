export interface EmailMailbox {
    id: string;
    workspaceId: number;
    address: string;
    name: string;
    enabled: boolean;
    version: number;
}
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
    sentAt: string | null;
    errorCode: string | null;
}
