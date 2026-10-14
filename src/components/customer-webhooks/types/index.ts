export interface WebhookEndpoint {
    id: string;
    workspaceId: number;
    name: string;
    url: string;
    eventTypes: string[];
    enabled: boolean;
    version: number;
    secretHint: string;
    createdAt: string;
    updatedAt: string;
}
export interface WebhookDelivery {
    id: string;
    endpointId: string;
    eventId: string;
    type: string;
    state: string;
    attempts: number;
    availableAt: string;
    lastStatus: number | null;
    lastError: string | null;
    createdAt: string;
    deliveredAt: string | null;
}
export interface WebhookList {
    endpoints: WebhookEndpoint[];
    eventTypes: string[];
    workerEnabled: boolean;
}
export interface DeliveryDetail {
    delivery: WebhookDelivery;
    payload: Record<string, unknown>;
    attempts: {
        url: string;
        id: string;
        attempt: number;
        state: string;
        status: number | null;
        error: string | null;
        startedAt: string;
        finishedAt: string | null;
    }[];
}
