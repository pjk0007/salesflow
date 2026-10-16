import { inboxRequest, inboxWrite } from "@/components/inbox/api";
import type { OperationsSettings, OperationsPolicy } from "../types";
export const operationsRequest = inboxRequest;
export const saveOperations = (
    id: number,
    version: number,
    policy: OperationsPolicy,
) =>
    inboxWrite<OperationsSettings>(`/api/inbox-operations/channels/${id}`, {
        version,
        policy,
    });
export const readSupportNotifications = (ids: string[]) =>
    inboxWrite("/api/inbox-notifications", { action: "read", ids });
