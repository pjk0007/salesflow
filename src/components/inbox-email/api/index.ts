import { inboxWrite } from "@/components/inbox/api";
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
