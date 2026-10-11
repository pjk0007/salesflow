/**
 * Gmail API 클라이언트 (회신 메일함 읽기 전용). DB를 모른다.
 *
 * OAuth 갱신 토큰(gmail.readonly) 하나로 메일함 하나를 읽는다 (DESIGN-RPL 2절). 고치기·지우기·라벨 붙이기는 하지 않는다.
 * 요청 모양(어떤 머리글을 받는지)은 email-reply-rules.ts의 *RequestPath가 정한다 — 남의 메일에는 받는 사람·스레드 머리글
 * 요청 말고는 아무 요청도 하지 않는다 (4-2).
 *
 * 비밀값(클라이언트 보안 비밀·갱신 토큰·접근 토큰)은 오류 글·로그에 남기지 않는다 (scrubGmailError).
 * 설계: docs/2026-10-11-reply-and-health/DESIGN-RPL.md 10-2절.
 */

import {
    REPORT_PART_MAX_BYTES,
    allHeadersRequestPath,
    fromRequestPath,
    fullRequestPath,
    recipientsRequestPath,
    reportPartRequestPath,
    type GmailHeader,
    type GmailPart,
} from "@/lib/email-reply-rules";

export const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_API_ORIGIN = "https://gmail.googleapis.com";
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 1_500;
/** 접근 토큰을 만료 이만큼 전에 버린다 */
const TOKEN_EARLY_EXPIRY_MS = 60_000;
const ERROR_DETAIL_MAX = 200;

export type GmailErrorCode = "auth" | "scope" | "rate_limited" | "history_expired" | "not_found" | "transient" | "config";

export class GmailApiError extends Error {
    readonly code: GmailErrorCode;
    readonly status: number | null;
    constructor(code: GmailErrorCode, status: number | null, message: string) {
        super(message);
        this.name = "GmailApiError";
        this.code = code;
        this.status = status;
    }
}

export interface GmailCredentials {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

export interface GmailClientOptions {
    /** 5xx·연결 오류 뒤 다시 보내기 전 기다림 (시험은 0) */
    retryDelayMs?: number;
    now?: () => number;
}

export interface GmailProfile {
    emailAddress: string;
    historyId: string;
}

export interface GmailHistoryRecord {
    id: string;
    messagesAdded?: Array<{ message: { id: string; threadId?: string; labelIds?: string[] } }>;
}

export interface GmailHistoryPage {
    history?: GmailHistoryRecord[];
    nextPageToken?: string;
    historyId: string;
}

export interface GmailMessageListPage {
    messages?: Array<{ id: string; threadId?: string }>;
    nextPageToken?: string;
}

/** messages.get 응답 (필요한 칸만) */
export interface GmailMessage {
    id: string;
    threadId?: string;
    labelIds?: string[];
    /** 밀리초 문자열 */
    internalDate?: string;
    sizeEstimate?: number;
    payload?: GmailPart & { headers?: GmailHeader[] };
}

export interface GmailReportPart {
    size: number;
    data: string;
}

/** 오류 글에서 비밀값·토큰·주소의 쿼리를 지운다 (google-chat.ts scrub과 같은 방식) */
export function scrubGmailError(message: string, secrets: readonly string[] = []): string {
    let out = message;
    for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[가림]");
    return out
        .replace(/\b(access_token|refresh_token|client_secret|code|token)=[^&\s"']+/gi, "$1=***")
        .replace(/"(access_token|refresh_token|client_secret|id_token)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
        .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi, "$1")
        .replace(/\bya29\.[A-Za-z0-9._-]+/g, "[가림]")
        .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, ERROR_DETAIL_MAX);
}

function describeThrown(err: unknown): string {
    if (err instanceof Error) {
        if (err.name === "TimeoutError" || err.name === "AbortError") return `응답 시간 초과 (${REQUEST_TIMEOUT_MS / 1000}초)`;
        const cause = (err as Error & { cause?: unknown }).cause;
        return `${err.message}${cause instanceof Error ? ` (${cause.message})` : ""}`;
    }
    return String(err);
}

// 접근 토큰 보관 (모듈 메모리, expires_in − 60초). 열쇠는 클라이언트 ID + 갱신 토큰 — 값은 어디에도 찍지 않는다
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearGmailTokenCache(): void {
    tokenCache.clear();
}

function cacheKey(cfg: GmailCredentials): string {
    return `${cfg.clientId}\u0000${cfg.refreshToken}`;
}

/** Google 오류 응답의 이유 글자들 (error.errors[].reason, error.status, error.details[].reason, error 문자열) */
function googleReasons(body: unknown): string[] {
    const out: string[] = [];
    if (!body || typeof body !== "object") return out;
    const b = body as Record<string, unknown>;
    if (typeof b.error === "string") out.push(b.error);
    const err = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>) : null;
    if (err) {
        if (typeof err.status === "string") out.push(err.status);
        for (const e of Array.isArray(err.errors) ? err.errors : []) {
            if (e && typeof e === "object" && typeof (e as Record<string, unknown>).reason === "string") out.push((e as { reason: string }).reason);
        }
        for (const d of Array.isArray(err.details) ? err.details : []) {
            if (d && typeof d === "object" && typeof (d as Record<string, unknown>).reason === "string") out.push((d as { reason: string }).reason);
        }
    }
    return out;
}

function googleMessage(body: unknown): string {
    if (!body || typeof body !== "object") return "";
    const b = body as Record<string, unknown>;
    if (typeof b.error_description === "string") return b.error_description;
    if (b.error && typeof b.error === "object" && typeof (b.error as Record<string, unknown>).message === "string") {
        return (b.error as { message: string }).message;
    }
    return typeof b.error === "string" ? b.error : "";
}

async function readJson(res: Response): Promise<unknown> {
    const text = await res.text().catch(() => "");
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return { error: text.slice(0, 200) };
    }
}

/** 403의 이유로 가른다: 범위 부족 → scope, 사용량 → rate_limited, API 꺼짐 → config, 그 밖 → auth */
export function classify403(reasons: readonly string[]): GmailErrorCode {
    const r = reasons.map((x) => x.toLowerCase());
    if (r.some((x) => x.includes("ratelimitexceeded") || x === "resource_exhausted" || x.includes("quota"))) return "rate_limited";
    if (r.some((x) => x.includes("insufficientpermissions") || x.includes("scope"))) return "scope";
    if (r.some((x) => x.includes("accessnotconfigured") || x.includes("service_disabled"))) return "config";
    return "auth";
}

/** 갱신 토큰으로 접근 토큰을 받는다 (보관된 것이 있으면 그것). invalid_grant·401 → auth */
export async function getAccessToken(
    cfg: GmailCredentials,
    fetchImpl: typeof fetch = fetch,
    opts: GmailClientOptions = {}
): Promise<string> {
    const now = opts.now ?? Date.now;
    const key = cacheKey(cfg);
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > now()) return cached.token;

    const secrets = [cfg.clientSecret, cfg.refreshToken];
    const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: "refresh_token",
    }).toString();

    for (let attempt = 1; ; attempt++) {
        let res: Response;
        try {
            res = await fetchImpl(GMAIL_TOKEN_URL, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (e) {
            if (attempt < 2) {
                await sleep(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
                continue;
            }
            throw new GmailApiError("transient", null, `토큰 요청 실패: ${scrubGmailError(describeThrown(e), secrets)}`);
        }
        const json = await readJson(res);
        if (res.ok) {
            const j = json as { access_token?: unknown; expires_in?: unknown } | null;
            if (!j || typeof j.access_token !== "string") {
                throw new GmailApiError("transient", res.status, "토큰 응답에 access_token이 없습니다");
            }
            const expiresIn = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 3600;
            tokenCache.set(key, { token: j.access_token, expiresAt: now() + expiresIn * 1000 - TOKEN_EARLY_EXPIRY_MS });
            return j.access_token;
        }
        const reasons = googleReasons(json).map((x) => x.toLowerCase());
        const detail = scrubGmailError(googleMessage(json) || reasons.join(","), secrets);
        if (res.status >= 500 || res.status === 429) {
            if (attempt < 2) {
                await sleep(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
                continue;
            }
            throw new GmailApiError(res.status === 429 ? "rate_limited" : "transient", res.status, `토큰 응답 ${res.status}: ${detail}`);
        }
        const code: GmailErrorCode =
            res.status === 401 || reasons.some((x) => x === "invalid_grant" || x === "invalid_client" || x === "unauthorized_client")
                ? "auth"
                : "config";
        throw new GmailApiError(code, res.status, `토큰 응답 ${res.status}: ${detail}`);
    }
}

function sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

export interface GmailClient {
    /** 이번 회차에 Gmail에 보낸 요청 수 (토큰 제외) */
    readonly calls: () => number;
    getProfile(): Promise<GmailProfile>;
    /** startHistoryId 뒤 messageAdded 기록. 404(너무 오래됨) → GmailApiError("history_expired") */
    listHistory(startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage>;
    listMessages(q: string, pageToken?: string, maxResults?: number): Promise<GmailMessageListPage>;
    /** 1단계: 받는 사람·스레드 머리글만. 그사이 지워졌으면 null */
    getMessageRecipients(id: string): Promise<GmailMessage | null>;
    /** 1.5단계 (시험 서버만): From만 */
    getMessageFrom(id: string): Promise<GmailMessage | null>;
    /** 2단계 (우리 것만): 머리글 전부와 본문 */
    getMessageFull(id: string): Promise<GmailMessage | null>;
    /** 2단계, 5MB 넘는 메일: 머리글 전부만 */
    getMessageAllHeaders(id: string): Promise<GmailMessage | null>;
    /** 반송·시스템 안내의 보고 부분만 (M9). 64KB가 넘으면 버린다 (null) */
    getReportPart(id: string, attachmentId: string): Promise<GmailReportPart | null>;
}

/**
 * 메일함 하나의 클라이언트. 오류 분류(10-2): 401·invalid_grant → auth · 403 범위 부족 → scope · 429·403 사용량 → rate_limited ·
 * history 404 → history_expired · 메시지 404 → null(그 메일 건너뜀) · 5xx·연결 오류 → 1.5초 뒤 한 번 다시, 그래도면 transient.
 */
export function createGmailClient(
    cfg: GmailCredentials,
    fetchImpl: typeof fetch = fetch,
    opts: GmailClientOptions = {}
): GmailClient {
    const secrets = [cfg.clientSecret, cfg.refreshToken];
    let calls = 0;

    async function request<T>(path: string, on404: "null" | "history"): Promise<T | null> {
        for (let attempt = 1; ; attempt++) {
            const token = await getAccessToken(cfg, fetchImpl, opts);
            let res: Response;
            calls++;
            try {
                res = await fetchImpl(`${GMAIL_API_ORIGIN}${path}`, {
                    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
            } catch (e) {
                if (attempt < 2) {
                    await sleep(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
                    continue;
                }
                throw new GmailApiError("transient", null, `Gmail 연결 실패: ${scrubGmailError(describeThrown(e), [...secrets, token])}`);
            }
            const json = await readJson(res);
            if (res.ok) return json as T;

            const detail = scrubGmailError(googleMessage(json), [...secrets, token]);
            if (res.status === 404) {
                if (on404 === "history") throw new GmailApiError("history_expired", 404, "history 기록이 너무 오래되었습니다");
                return null;
            }
            if (res.status === 401) {
                // 보관한 접근 토큰이 끊겼을 수 있다 — 한 번은 새 토큰으로 다시
                tokenCache.delete(cacheKey(cfg));
                if (attempt < 2) continue;
                throw new GmailApiError("auth", 401, `Gmail 응답 401: ${detail}`);
            }
            if (res.status === 403) {
                const code = classify403(googleReasons(json));
                throw new GmailApiError(code, 403, `Gmail 응답 403: ${detail}`);
            }
            if (res.status === 429) throw new GmailApiError("rate_limited", 429, `Gmail 응답 429: ${detail}`);
            if (res.status >= 500) {
                if (attempt < 2) {
                    await sleep(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
                    continue;
                }
                throw new GmailApiError("transient", res.status, `Gmail 응답 ${res.status}: ${detail}`);
            }
            throw new GmailApiError("config", res.status, `Gmail 응답 ${res.status}: ${detail}`);
        }
    }

    return {
        calls: () => calls,
        async getProfile() {
            const p = await request<{ emailAddress?: unknown; historyId?: unknown }>("/gmail/v1/users/me/profile", "null");
            if (!p || typeof p.emailAddress !== "string") throw new GmailApiError("transient", null, "메일함 정보를 읽지 못했습니다");
            return { emailAddress: p.emailAddress, historyId: String(p.historyId ?? "") };
        },
        async listHistory(startHistoryId, pageToken) {
            const q = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
            if (pageToken) q.set("pageToken", pageToken);
            const page = await request<GmailHistoryPage>(`/gmail/v1/users/me/history?${q.toString()}`, "history");
            return page ?? { historyId: startHistoryId };
        },
        async listMessages(query, pageToken, maxResults = 500) {
            const q = new URLSearchParams({ q: query, maxResults: String(maxResults), includeSpamTrash: "true" });
            if (pageToken) q.set("pageToken", pageToken);
            return (await request<GmailMessageListPage>(`/gmail/v1/users/me/messages?${q.toString()}`, "null")) ?? {};
        },
        getMessageRecipients: (id) => request<GmailMessage>(recipientsRequestPath(id), "null"),
        getMessageFrom: (id) => request<GmailMessage>(fromRequestPath(id), "null"),
        getMessageFull: (id) => request<GmailMessage>(fullRequestPath(id), "null"),
        getMessageAllHeaders: (id) => request<GmailMessage>(allHeadersRequestPath(id), "null"),
        async getReportPart(id, attachmentId) {
            const part = await request<{ size?: unknown; data?: unknown }>(reportPartRequestPath(id, attachmentId), "null");
            if (!part || typeof part.data !== "string") return null;
            const size = typeof part.size === "number" ? part.size : Buffer.byteLength(part.data, "base64url");
            if (size > REPORT_PART_MAX_BYTES) return null;
            return { size, data: part.data };
        },
    };
}
