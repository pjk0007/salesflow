export async function inboxRequest<T>(
    url: string,
    options?: RequestInit,
): Promise<T> {
    const response = await fetch(url, {
        ...options,
        headers: { "Content-Type": "application/json", ...options?.headers },
        cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok || !result.success)
        throw new Error(result.error || "요청을 처리하지 못했습니다.");
    return result.data;
}
export function inboxWrite<T>(url: string, data: unknown, method = "POST") {
    return inboxRequest<T>(url, { method, body: JSON.stringify(data) });
}
