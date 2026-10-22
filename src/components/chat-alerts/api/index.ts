import type { ApiResponse } from "@/types";
import type { ChatSpaceInput } from "../types";

async function send<T>(url: string, method: string, body?: unknown): Promise<ApiResponse<T>> {
    try {
        const res = await fetch(url, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        return await res.json();
    } catch {
        return { success: false, error: "서버에 연결할 수 없습니다." };
    }
}

export const CHAT_SPACES_URL = "/api/chat-spaces";

export const createChatSpace = (input: ChatSpaceInput) =>
    send<{ id: number; name: string }>(CHAT_SPACES_URL, "POST", input);

export const updateChatSpace = (id: number, input: ChatSpaceInput) =>
    send<{ id: number; name: string }>(`${CHAT_SPACES_URL}/${id}`, "PATCH", input);

export const deleteChatSpace = (id: number) => send(`${CHAT_SPACES_URL}/${id}`, "DELETE");

export const testChatSpace = (id: number) => send(`${CHAT_SPACES_URL}/${id}/test`, "POST");
