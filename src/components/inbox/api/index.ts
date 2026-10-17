import { messengerApiUrl } from "@/components/customer-messenger/api-origin";
export class InboxRequestError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message);
    }
}
export async function inboxRequest<T>(
    url: string,
    options?: RequestInit,
): Promise<T> {
    const target = messengerApiUrl(url);
    const response = await fetch(target, {
        ...options,
        ...(target !== url ? { credentials: "omit" as const, redirect: "error" as const } : {}),
        headers: {
            ...(options?.body instanceof FormData
                ? {}
                : { "Content-Type": "application/json" }),
            ...options?.headers,
        },
        cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok || !result.success)
        throw new InboxRequestError(
            result.error || "요청을 처리하지 못했습니다.",
            response.status,
        );
    return result.data;
}
export function inboxWrite<T>(url: string, data: unknown, method = "POST") {
    return inboxRequest<T>(url, { method, body: JSON.stringify(data) });
}
