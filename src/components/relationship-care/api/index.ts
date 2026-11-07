import { inboxRequest, inboxWrite } from "@/components/inbox/api";
import type {
    Care,
    CareAction,
    Channel,
    CardReason,
    Draft,
    RegisterResult,
    ScannedCard,
} from "../types";
const base = "/api/customer-crm/relationship";
export const relationshipRequest = inboxRequest;
export const careUrl = (workspaceId: number, contactId: string) =>
    `${base}/${contactId}?workspaceId=${workspaceId}`;
export const todayUrl = (workspaceId: number, scope: "mine" | "all") =>
    `${base}/today?workspaceId=${workspaceId}&scope=${scope}`;
export const saveCare = (contactId: string, body: Record<string, unknown>) =>
    inboxWrite<{ care: Care }>(`${base}/${contactId}`, body, "PUT");
export const careAction = (
    workspaceId: number,
    contactId: string,
    action: CareAction,
    extra: { channel?: Channel; reason?: CardReason; note?: string } = {},
) =>
    inboxWrite<{ care: Care }>(`${base}/${contactId}/actions`, {
        workspaceId,
        action,
        ...extra,
    });
export const aiDraft = (workspaceId: number, contactId: string, reason: CardReason) =>
    inboxWrite<Draft & { basis: string[] }>(`${base}/${contactId}/draft`, {
        workspaceId,
        reason,
    });
export function scanCard(workspaceId: number, image: File) {
    const form = new FormData();
    form.set("image", image);
    return inboxRequest<{ fields: ScannedCard }>(
        `${base}/business-card/scan?workspaceId=${workspaceId}`,
        { method: "POST", body: form },
    );
}
export const registerCard = (body: Record<string, unknown>) =>
    inboxWrite<RegisterResult>(`${base}/business-card`, body);
