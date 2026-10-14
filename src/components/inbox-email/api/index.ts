import { inboxWrite } from "@/components/inbox/api";
import type { GoogleConnectionAction } from "../types";
export const controlGoogleConnection = (
    id: string,
    input: GoogleConnectionAction,
) =>
    inboxWrite<{ authorizationUrl?: string; retried?: number }>(
        `/api/email-mailboxes/${id}/google`,
        input,
    );
export const retryIncomingFile = (id: string) =>
    inboxWrite(`/api/email-files/${id}`, { action: "retry" });
export { inboxRequest as emailRequest } from "@/components/inbox/api";
export const createEmailMailbox = (
    workspaceId: number,
    address: string,
    name: string,
) => inboxWrite("/api/email-mailboxes", { workspaceId, address, name });
export const toggleEmailMailbox = (
    id: string,
    version: number,
    enabled: boolean,
) => inboxWrite(`/api/email-mailboxes/${id}`, { version, enabled });
export const changeDelivery = (id: string, action: "retry" | "cancel") =>
    inboxWrite(`/api/email-deliveries/${id}`, { action });
