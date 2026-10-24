/** HTTP 상태를 유지해 세션 만료·권한 오류를 호출부가 구분할 수 있다. */
export class RequestError extends Error {
    constructor(message: string, public status: number) {
        super(message);
        this.name = "RequestError";
    }
}

export interface RequestMessages {
    timeout?: string;
    network?: string;
    unreadable?: string;
}

/** 서버가 제공하는 한국어 안내만 노출하며 영어·내부 오류는 고정 문구로 대체한다. */
function responseError(value: unknown): string {
    if (typeof value !== "string" || !/[가-힣]/.test(value) ||
        /(?:SQLSTATE|Failed query|\b(?:select|insert|update|delete)\s|\bat\s+\S+\(|(?:postgres|drizzle|node_modules))/i.test(value)) {
        return "요청을 처리하지 못했습니다.";
    }
    return value;
}

/**
 * 조회·변경 공용 전송. 성공 본문 전체를 그대로 반환한다.
 * 실패는 RequestError로 전달하며 변경 요청을 자동 재시도하지 않는다.
 */
export async function apiRequest<T = unknown>(
    url: string,
    options?: RequestInit,
    timeoutMs = options?.body instanceof FormData ? 120000 : 15000,
    messages: RequestMessages = {},
): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(options?.signal?.reason);
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) abort();
    const write = !["GET", "HEAD"].includes((options?.method ?? "GET").toUpperCase());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new RequestError(messages.timeout ?? (write
                ? "요청 결과 확인이 지연되고 있습니다. 변경 여부를 확인한 뒤 다시 시도해주세요."
                : "조회가 지연되고 있습니다. 잠시 후 다시 시도해주세요."), 408));
            controller.abort();
        }, timeoutMs);
    });
    try {
        return await Promise.race([deadline, (async () => {
            let response: Response;
            try {
                response = await fetch(url, { ...options, signal: controller.signal });
            } catch {
                if (options?.signal?.aborted) throw options.signal.reason;
                throw new RequestError(messages.network ?? (write
                    ? "서버에 연결할 수 없습니다. 변경 여부를 확인한 뒤 다시 시도해주세요."
                    : "서버에 연결할 수 없습니다. 다시 시도해주세요."), 0);
            }
            let result: unknown;
            try {
                result = await response.json();
            } catch {
                if (options?.signal?.aborted) throw options.signal.reason;
                throw new RequestError(messages.unreadable ?? "서버 응답을 읽지 못했습니다.", response.status);
            }
            const envelope = result !== null && typeof result === "object"
                ? result as { success?: unknown; error?: unknown } : undefined;
            if (!response.ok || envelope?.success === false) {
                throw new RequestError(responseError(envelope?.error), response.status);
            }
            return result as T;
        })()]);
    } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}

// 기본 any는 기존 무타입 useSWR·직접 조회 소비자의 성공 응답 추론과 호환된다.
// TypeScript의 Response.json() 반환형을 그대로 따른다.
export const defaultFetcher = (url: string): ReturnType<Response["json"]> => apiRequest(url);
