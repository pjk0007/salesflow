import { inboxRequest, InboxRequestError } from "@/components/inbox/api";
import type { CustomerConversationPage, CustomerReadAck } from "../types";

async function request<T>(url: string, options: RequestInit) {
    try {
        return await inboxRequest<T>(url, {
            ...options,
            signal: AbortSignal.timeout(15000),
        });
    } catch (error) {
        if (error instanceof InboxRequestError) throw error;
        throw new Error("문의 연결이 지연되고 있습니다. 잠시 뒤 다시 시도해주세요.");
    }
}

export function customerConversationApi(channelKey: string) {
    const url = `/api/messenger/${encodeURIComponent(channelKey)}/conversations`;
    return {
        page(token: string, before?: string) {
            return request<CustomerConversationPage>(
                `${url}${before ? `?before=${encodeURIComponent(before)}` : ""}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
        },
        read(token: string, id: string, lastMessageId: number, readRevision?: number) {
            return request<CustomerReadAck>(
                `${url}/${encodeURIComponent(id)}/read`,
                {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ lastMessageId, readRevision }),
                },
            );
        },
    };
}
