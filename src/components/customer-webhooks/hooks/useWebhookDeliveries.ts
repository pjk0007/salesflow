"use client";
import useSWRInfinite from "swr/infinite";
import { webhookRequest } from "../api";
import type { WebhookDelivery } from "../types";
export function useWebhookDeliveries(id: string, state: string) {
    return useSWRInfinite<{ rows: WebhookDelivery[]; hasMore: boolean }>(
        (index, previous) =>
            previous && !previous.hasMore
                ? null
                : `/api/customer-platform/webhooks/${id}/deliveries?${new URLSearchParams({ ...(state ? { state } : {}), ...(index ? { before: previous!.rows.at(-1)!.id } : {}) })}`,
        webhookRequest,
        { refreshInterval: 5000 },
    );
}
