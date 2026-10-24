import { messengerApiUrl } from "@/components/customer-messenger/api-origin";
import { apiRequest, RequestError } from "@/lib/swr-fetcher";
export { RequestError as InboxRequestError } from "@/lib/swr-fetcher";
export async function inboxRequest<T>(
    url: string,
    options?: RequestInit,
    // File uploads need a larger budget than reading or sending text messages.
    timeoutMs = options?.body instanceof FormData ? 120000 : 15000,
): Promise<T> {
    const target = messengerApiUrl(url);
    const write = !["GET", "HEAD"].includes((options?.method ?? "GET").toUpperCase());
    const headers = options?.headers instanceof Headers
        ? Object.fromEntries(options.headers.entries())
        : Array.isArray(options?.headers) ? Object.fromEntries(options.headers) : { ...options?.headers };
    if (!(options?.body instanceof FormData) && !new Headers(headers).has("Content-Type"))
        headers["Content-Type"] = "application/json";
    const result = await apiRequest<{ success: boolean; data: T }>(target, {
        ...options,
        ...(target !== url ? { credentials: "omit" as const, redirect: "error" as const } : {}),
        headers,
        cache: "no-store",
    }, timeoutMs, {
        timeout: write
            ? "요청 결과 확인이 지연되고 있습니다. 초안은 유지됩니다. 대화에서 전송 여부를 확인한 뒤 다시 시도해주세요."
            : "상담 조회가 지연되고 있습니다. 잠시 후 다시 시도해주세요.",
        network: write
            ? "서버에 연결할 수 없습니다. 초안은 유지됩니다. 대화에서 전송 여부를 확인한 뒤 다시 시도해주세요."
            : "서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해주세요.",
        unreadable: write
            ? "서버 응답을 읽지 못했습니다. 초안은 유지됩니다. 대화에서 전송 여부를 확인한 뒤 다시 시도해주세요."
            : "서버 응답을 읽지 못했습니다.",
    });
    if (!result || result.success !== true)
        throw new RequestError("서버 응답을 읽지 못했습니다.", 200);
    return result.data;
}
export function inboxWrite<T>(url: string, data: unknown, method = "POST") {
    return inboxRequest<T>(url, { method, body: JSON.stringify(data) });
}
