import { inboxRequest } from "@/components/inbox/api";
import type { InboxPresence, AgentActivity } from "../types";
async function presenceRequest<T>(url: string, options?: RequestInit) {
    try {
        return await inboxRequest<T>(url, {
            ...options,
            signal: AbortSignal.timeout(10000),
        });
    } catch (error) {
        if (["TimeoutError", "AbortError"].includes((error as Error).name))
            throw new Error(
                "접속 상태 확인이 지연되고 있습니다. 연결을 확인해주세요.",
            );
        throw error;
    }
}
export const loadPresence = (url: string) =>
    presenceRequest<InboxPresence>(url);
export const sendPresence = (input: {
    channelId: number;
    sessionId: string;
    sequence: number;
    conversationId: string | null;
    activity: AgentActivity;
    leave: boolean;
}) =>
    presenceRequest<{ accepted: boolean }>("/api/inbox-presence", {
        method: "POST",
        body: JSON.stringify(input),
    });
export const saveAvailability = (input: {
    channelId: number;
    version: number;
    state: "available" | "away";
}) =>
    presenceRequest<{ state: "available" | "away"; version: number }>(
        "/api/inbox-presence",
        { method: "PATCH", body: JSON.stringify(input) },
    );
