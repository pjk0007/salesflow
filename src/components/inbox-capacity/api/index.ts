import { inboxRequest, inboxWrite } from "@/components/inbox/api";
import type { CapacityPage, DispatchResult } from "../types";
export const loadCapacity = (url: string) => inboxRequest<CapacityPage>(url);
export const saveCapacity = (input: {
    channelId: number;
    userId: string;
    version: number;
    maxOpenConversations: number | null;
}) => inboxWrite("/api/inbox-capacity", input, "PATCH");
export const dispatchCapacity = (channelId: number) =>
    inboxWrite<DispatchResult>("/api/inbox-capacity", {
        channelId,
        action: "dispatch",
    });
