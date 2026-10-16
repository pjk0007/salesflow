export const CHANNEL_SOURCE_VERSION = "2026-06-01";
export const CHANNEL_SOURCE_API_BASE = "https://api.channel.io";
export const CHANNEL_SOURCE_MAX_JSON_BYTES = 16 * 1024 * 1024;
export type ChannelSourceHttpInput = {
    method: "GET";
    path: string;
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    headers: Readonly<Record<string, string>>;
    timeoutMs: number;
    signal?: AbortSignal;
};
export type ChannelSourceHttpResponse = {
    status: number;
    headers: Record<string, string>;
    body: unknown;
};
export type ChannelSourceRequest = (
    input: ChannelSourceHttpInput,
) => Promise<ChannelSourceHttpResponse>;
type ErrorCode =
    | "configuration"
    | "request"
    | "version"
    | "redirect"
    | "too_large"
    | "json"
    | "timeout"
    | "aborted"
    | "network";
export class ChannelSourceHttpError extends Error {
    constructor(
        message: string,
        readonly code: ErrorCode,
    ) {
        super(message);
        this.name = "ChannelSourceHttpError";
    }
}
const failure = (message: string, code: ErrorCode) =>
    new ChannelSourceHttpError(message, code);
function credential(value: string) {
    if (typeof value !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(value))
        throw failure("채널톡 조회 인증 정보를 확인해주세요.", "configuration");
    return value;
}
function apiBase(raw: string, injected: boolean) {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw failure("채널톡 조회 서버 설정을 확인해주세요.", "configuration");
    }
    if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        (url.origin !== CHANNEL_SOURCE_API_BASE && !injected) ||
        (url.protocol !== "https:" &&
            !(
                injected &&
                url.protocol === "http:" &&
                ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
            ))
    )
        throw failure("채널톡 조회 서버 설정을 확인해주세요.", "configuration");
    return url.origin;
}
function sourcePath(path: string) {
    // IDs must remain single path segments; file keys belong in the query only.
    if (
        typeof path !== "string" ||
        !/^\/open\/(?:channel|bots|managers(?:\/[^/?#\\]+)?|users\/[^/?#\\]+(?:\/user-chats)?|user-chats(?:\/[^/?#\\]+(?:\/messages(?:\/file)?)?)?)$/.test(
            path,
        )
    )
        throw failure("지원하는 채널톡 자료 조회 경로를 확인해주세요.", "request");
    try {
        for (const segment of path.split("/").slice(2)) {
            const value = decodeURIComponent(segment);
            if (
                value === "." ||
                value === ".." ||
                /[\x00-\x20\x7f/\\?#]/.test(value) ||
                /%(?:2e|2f|5c|00)/i.test(value)
            )
                throw new Error();
        }
    } catch {
        throw failure("채널톡 자료 식별자를 확인해주세요.", "request");
    }
    return path;
}
function sourceUrl(base: string, input: ChannelSourceHttpInput) {
    if (
        input.method !== "GET" ||
        !Number.isSafeInteger(input.timeoutMs) ||
        input.timeoutMs < 1 ||
        input.timeoutMs > 120000
    )
        throw failure("채널톡 조회 요청과 제한 시간을 확인해주세요.", "request");
    const headers = Object.entries(input.headers);
    if (
        headers.length !== 1 ||
        headers[0][0].toLowerCase() !== "channel-version" ||
        headers[0][1] !== CHANNEL_SOURCE_VERSION
    )
        throw failure("채널톡 조회 버전을 확인해주세요.", "version");
    const url = new URL(sourcePath(input.path), base);
    for (const [key, value] of Object.entries(input.query ?? {})) {
        if (value === undefined) continue;
        if (
            !key ||
            !["string", "number", "boolean"].includes(typeof value) ||
            (typeof value === "number" && !Number.isFinite(value))
        )
            throw failure("채널톡 조회 조건을 확인해주세요.", "request");
        url.searchParams.set(key, String(value));
    }
    return url;
}
/** Fixed-host, GET-only source transport. Retries and pagination belong to the collector. */
export function createChannelSourceRequest(options: {
    accessKey: string;
    accessSecret: string;
    fetch?: typeof fetch;
    baseUrl?: string;
    maxResponseBytes?: number;
}): ChannelSourceRequest {
    const accessKey = credential(options.accessKey),
        accessSecret = credential(options.accessSecret),
        transport = options.fetch ?? globalThis.fetch,
        base = apiBase(
            options.baseUrl ?? CHANNEL_SOURCE_API_BASE,
            !!options.fetch && options.fetch !== globalThis.fetch,
        ),
        limit = options.maxResponseBytes ?? CHANNEL_SOURCE_MAX_JSON_BYTES;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 * 1024 * 1024)
        throw failure("채널톡 조회 응답 크기 설정을 확인해주세요.", "configuration");
    return async (input) => {
        const url = sourceUrl(base, input);
        if (input.signal?.aborted)
            throw failure("채널톡 자료 조회가 중단됐습니다.", "aborted");
        const controller = new AbortController();
        const deadline = Date.now() + input.timeoutMs;
        let timedOut = false,
            reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
            responseBody: ReadableStream<Uint8Array> | null | undefined,
            finished = false;
        const stop = () => controller.abort();
        const checkDeadline = () => {
            if (Date.now() >= deadline) {
                timedOut = true;
                stop();
            }
            controller.signal.throwIfAborted();
        };
        input.signal?.addEventListener("abort", stop, { once: true });
        const timer = setTimeout(() => {
            timedOut = true;
            stop();
        }, input.timeoutMs);
        let rejectAbort: () => void = () => {};
        const abort = new Promise<never>((_, reject) => {
            rejectAbort = () =>
                reject(
                    failure(
                        timedOut
                            ? "채널톡 자료 조회 시간이 초과됐습니다. 다시 시도해주세요."
                            : "채널톡 자료 조회가 중단됐습니다.",
                        timedOut ? "timeout" : "aborted",
                    ),
                );
            controller.signal.addEventListener("abort", rejectAbort, { once: true });
        });
        try {
            const operation = (async (): Promise<ChannelSourceHttpResponse> => {
                const response = await transport(url, {
                    method: "GET",
                    headers: {
                        "Accept": "application/json",
                        "Channel-Version": CHANNEL_SOURCE_VERSION,
                        "x-access-key": accessKey,
                        "x-access-secret": accessSecret,
                    },
                    signal: controller.signal,
                    redirect: "error",
                    credentials: "omit",
                    cache: "no-store",
                });
                responseBody = response.body;
                checkDeadline();
                if (
                    response.redirected ||
                    (response.status >= 300 && response.status < 400) ||
                    (response.url && new URL(response.url).origin !== base)
                )
                    throw failure("채널톡 조회 응답의 이동 주소를 허용하지 않습니다.", "redirect");
                const version = response.headers.get("channel-version");
                if (
                    (version !== null && version !== CHANNEL_SOURCE_VERSION) ||
                    (response.ok && version === null)
                )
                    throw failure("채널톡 응답 버전이 조회 계약과 맞지 않습니다.", "version");
                const declaredSize = response.headers.get("content-length");
                if (declaredSize && /^\d+$/.test(declaredSize) && Number(declaredSize) > limit)
                    throw failure("채널톡 조회 응답이 크기 제한을 넘었습니다.", "too_large");
                const chunks: Uint8Array[] = [];
                let size = 0;
                reader = response.body?.getReader();
                if (reader) {
                    while (true) {
                        const next = await reader.read();
                        checkDeadline();
                        if (next.done) break;
                        size += next.value.byteLength;
                        if (size > limit)
                            throw failure("채널톡 조회 응답이 크기 제한을 넘었습니다.", "too_large");
                        chunks.push(Uint8Array.from(next.value));
                    }
                }
                finished = true;
                let body: unknown;
                try {
                    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
                    try {
                        body = text.trim() ? JSON.parse(text) : null;
                    } catch {
                        // Error pages still reach the collector with their HTTP status, bounded.
                        if (!response.ok) body = text;
                        else throw new Error();
                    }
                } catch {
                    throw failure("채널톡 조회 응답 형식을 확인해주세요.", "json");
                }
                checkDeadline();
                const headers: Record<string, string> = {};
                for (const name of ["channel-version", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-scope", "warning", "deprecation", "sunset"])
                    if (response.headers.has(name)) headers[name] = response.headers.get(name)!;
                return { status: response.status, headers, body };
            })();
            return await Promise.race([operation, abort]);
        } catch (error) {
            if (error instanceof ChannelSourceHttpError) throw error;
            if (controller.signal.aborted)
                throw failure(
                    timedOut
                        ? "채널톡 자료 조회 시간이 초과됐습니다. 다시 시도해주세요."
                        : "채널톡 자료 조회가 중단됐습니다.",
                    timedOut ? "timeout" : "aborted",
                );
            throw failure("채널톡 자료 조회에 연결하지 못했습니다. 네트워크를 확인해주세요.", "network");
        } finally {
            clearTimeout(timer);
            input.signal?.removeEventListener("abort", stop);
            controller.signal.removeEventListener("abort", rejectAbort);
            if (reader) {
                if (!finished) void reader.cancel().catch(() => {});
                else reader.releaseLock();
            } else if (!finished) void responseBody?.cancel().catch(() => {});
            if (!finished) controller.abort();
        }
    };
}
