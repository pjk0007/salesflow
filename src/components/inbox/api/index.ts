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
    // File uploads need a larger budget than reading or sending text messages.
    timeoutMs = options?.body instanceof FormData ? 120000 : 15000,
): Promise<T> {
    const target = messengerApiUrl(url);
    const controller = new AbortController();
    const abort = () => controller.abort(options?.signal?.reason);
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            const write = options?.method && options.method !== "GET";
            reject(new InboxRequestError(write
                ? "요청 결과 확인이 지연되고 있습니다. 초안은 유지됩니다. 대화에서 전송 여부를 확인한 뒤 다시 시도해주세요."
                : "상담 조회가 지연되고 있습니다. 잠시 후 다시 시도해주세요.", 408));
            controller.abort();
        }, timeoutMs);
    });
    try {
        return await Promise.race([deadline, (async () => {
            const response = await fetch(target, {
                ...options,
                ...(target !== url ? { credentials: "omit" as const, redirect: "error" as const } : {}),
                signal: controller.signal,
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
        })()]);
    } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}
export function inboxWrite<T>(url: string, data: unknown, method = "POST") {
    return inboxRequest<T>(url, { method, body: JSON.stringify(data) });
}
