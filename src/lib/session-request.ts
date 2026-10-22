/** Bound both response headers and body reads; only 401 means unauthenticated. */
export async function fetchSessionResponse(fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetcher("/api/auth/me", { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) return { success: false };
        if (!response.ok) throw new Error("session_unavailable");
        const data = await response.json();
        if (data.success !== true || !data.user) throw new Error("session_invalid_response");
        return data;
    } finally {
        clearTimeout(timer);
    }
}
