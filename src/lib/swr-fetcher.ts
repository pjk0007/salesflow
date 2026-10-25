import type { SWRConfiguration } from "swr";

/**
 * HTTP 상태를 유지해 세션 만료·권한 오류를 호출부가 구분할 수 있다.
 * fromServer는 서버가 준 한국어 안내를 그대로 담았는지 여부다(전송·해석 실패 문구는 false).
 */
export class RequestError extends Error {
    constructor(message: string, public status: number, public fromServer = false) {
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
    // 운영 발송 이력 검색이 12초 넘게 걸린다 — 정상 조회를 끊지 않도록 프록시 한도(60초)에 맞춘다.
    timeoutMs = options?.body instanceof FormData ? 120000 : 60000,
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
            } catch (cause) {
                if (options?.signal?.aborted) throw options.signal.reason;
                // 호출부의 시간 초과·중단 분기(inbox-presence 등)가 이름으로 구분하므로 그대로 전달한다.
                if (cause instanceof Error && ["AbortError", "TimeoutError"].includes(cause.name)) throw cause;
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
                const message = responseError(envelope?.error);
                throw new RequestError(message, response.status, message === envelope?.error);
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

/**
 * SWR은 재검증이 실패해도 이전 data를 유지하고 error만 설정한다.
 * 보여줄 자료가 아직 없을 때의 오류만 돌려줘 화면 전체 오류 표시는 이 값으로만 한다.
 */
export function blockingError(data: unknown, error: unknown): unknown {
    return data === undefined ? error : undefined;
}

/** 서버가 준 구체적인 안내(4xx·논리 오류)는 그대로, 전송 실패·서버 장애는 화면별 안내로 표시한다. */
export function requestErrorMessage(error: unknown, fallback: string): string {
    return error instanceof RequestError && error.fromServer && error.status < 500 ? error.message : fallback;
}

/** 다시 요청해도 결과가 같은 오류. 408·429는 잠시 뒤 성공할 수 있어 제외한다. */
export function isPermanentRequestError(error: unknown): boolean {
    return error instanceof RequestError && error.status >= 400 && error.status < 500 &&
        error.status !== 408 && error.status !== 429;
}

/**
 * 앱 전역 SWR 오류 처리. 권한·입력 오류는 재시도하지 않고, 401은 세션 확인으로 넘기며,
 * 이미 표시 중인 자료의 재검증 실패는 화면을 유지한 채 알림만 띄운다.
 */
export function createSwrErrorHandlers(options: {
    retry: NonNullable<SWRConfiguration["onErrorRetry"]>;
    hasData: (key: string) => boolean;
    onUnauthorized: () => void;
    onStaleError: (error: unknown) => void;
}): Pick<SWRConfiguration, "onError" | "onErrorRetry"> {
    return {
        onErrorRetry: (error, key, config, revalidate, revalidateOptions) => {
            if (isPermanentRequestError(error)) return;
            options.retry(error, key, config, revalidate, revalidateOptions);
        },
        onError: (error, key) => {
            if (error instanceof RequestError && error.status === 401) options.onUnauthorized();
            else if (options.hasData(key)) options.onStaleError(error);
        },
    };
}
