export interface EmailMailbox {
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
    sentAt: string | null;
    errorCode: string | null;
}
