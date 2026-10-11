/**
 * 구글 챗 수신 웹훅으로 글 한 통 보내기. DB를 모른다.
 *
 * 웹훅 주소는 그 자체가 비밀값이다 (주소의 key·token만 있으면 누구나 그 스페이스에 쓸 수 있다).
 * 그래서 돌려주는 오류 글에 주소·쿼리를 절대 넣지 않는다 — 오류 글은 deep_visitor_alerts.last_error와
 * 관리자 목록 응답에 그대로 남는다.
 *
 * 공식 제약 (docs/2026-10-11-reply-and-health/CHAT-QA.md 1절):
 *   - 주소는 https://chat.googleapis.com/v1/spaces/<id>/messages?key=…&token=… 꼴만 받는다 (설정을 잘못 넣어 고객 정보가
 *     구글 밖으로 나가지 않게, CT-6·DV-3)
 *   - 스페이스당 초당 1통 (그 스페이스의 웹훅 모두가 나눠 씀) — 이 프로세스 안의 모든 알림(깊이·회신·건강·풀림)이
 *     스페이스마다 한 줄로 서서 1.1초 간격을 지킨다 (CT-2). CloudType 인스턴스 하나라 프로세스 안 장치로 충분하다
 *   - 429·5xx·연결 오류는 무작위 지연을 더해 다시 보낸다 (429는 Retry-After를 따른다)
 *   - 응답 시간 초과는 구글이 이미 글을 올렸을 수 있다 — 바로 다시 보내지 않고 uncertain으로 돌려준다 (CT-1).
 *     다시 보낼지는 워커가 정한다 (requestId를 켜면 구글이 같은 요청을 한 번만 만든다)
 *   - 어떤 패밀리도 멘션을 쓰지 않는다 — 마지막 방어로 '<users/'를 '‹users/'로 바꾼다 (CT-4)
 */

import { createHash } from "node:crypto";

export type GoogleChatResult =
    | { ok: true }
    | {
          ok: false;
          status: number | null;
          error: string;
          retryable: boolean;
          /** 응답이 시간 초과로 끊겼다 — 구글이 이미 올렸을 수 있다 (바로 다시 보내지 않았다) */
          uncertain?: true;
      };

export interface ChatPostOptions {
    /** 다시 보내기 전 기다림의 바탕 (기본 1.5초 + 무작위 0~1초). 시험은 0 */
    retryDelayMs?: number;
    /** 같은 스페이스 보내기 사이 간격 (기본 1.1초). 시험은 0 */
    spaceIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    /** 같은 스레드로 모을 키 (GOOGLE_CHAT_THREADS=on일 때만 부른 쪽이 넘긴다) */
    threadKey?: string;
    /** 같은 요청을 한 번만 만들게 하는 값 (GOOGLE_CHAT_REQUEST_ID=on일 때만 부른 쪽이 넘긴다) */
    requestId?: string;
}

export const REQUEST_TIMEOUT_MS = 10_000;
/** 스페이스당 초당 1통 — 조금 여유를 둔다 */
export const SPACE_INTERVAL_MS = 1_100;
const DEFAULT_RETRY_DELAY_MS = 1_500;
const RETRY_JITTER_MS = 1_000;
/** 429는 두 번까지 (2초·4초 + 무작위), 5xx·연결 오류는 한 번 */
const MAX_RETRIES_429 = 2;
const MAX_RETRIES_OTHER = 1;
/** Retry-After를 이보다 길게 기다리지 않는다 (회차 예산 안에서) */
const RETRY_AFTER_CAP_MS = 10_000;
const ERROR_DETAIL_MAX = 120;

function isRetryableStatus(status: number): boolean {
    // 400·401·403·404는 주소나 글이 잘못된 것이라 다시 보내도 같다
    return status === 429 || status >= 500;
}

/**
 * 웹훅 주소 문제 (없으면 null). 구글 챗 수신 웹훅 주소만 받는다 — https, 호스트 chat.googleapis.com, 경로 /v1/spaces/<id>/messages.
 * 주소를 잘못 넣어(오타 도메인 등) 고객 연락처가 든 카드가 구글 밖으로 나가지 않게 (CT-6·DV-3)
 */
export function chatWebhookProblem(webhookUrl: string | null | undefined): null | "missing" | "invalid" | "not_https" | "not_google" {
    const raw = (webhookUrl ?? "").trim();
    if (!raw) return "missing";
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return "invalid";
    }
    if (parsed.protocol !== "https:") return "not_https";
    if (parsed.hostname.toLowerCase() !== "chat.googleapis.com" || !/^\/v1\/spaces\/[^/]+\/messages$/.test(parsed.pathname)) {
        return "not_google";
    }
    return null;
}

/** 웹훅 주소 문제 → 한국어 한 줄 (주소는 넣지 않는다) */
export function chatWebhookProblemText(problem: ReturnType<typeof chatWebhookProblem>): string {
    switch (problem) {
        case "missing":
            return "웹훅 주소 없음";
        case "invalid":
            return "웹훅 주소 형식 오류 (주소로 읽을 수 없음)";
        case "not_https":
            return "웹훅 주소 형식 오류 (https 주소가 아님)";
        case "not_google":
            return "웹훅 주소 형식 오류 (구글 챗 수신 웹훅 주소가 아님 — 호스트가 chat.googleapis.com이어야 함)";
        default:
            return "";
    }
}

/** 오류 글에서 웹훅 주소와 그 조각(key·token)을 지운다 — 원래 값과 URL 인코딩된 값 모두 (CT-9) */
function scrub(message: string, webhookUrl: string): string {
    let out = message;
    const forms = (v: string) => [...new Set([v, encodeURIComponent(v), encodeURI(v)])].filter(Boolean);
    if (webhookUrl) for (const f of forms(webhookUrl)) out = out.split(f).join("[웹훅 주소]");
    const parts: string[] = [];
    try {
        const u = new URL(webhookUrl);
        for (const name of ["key", "token"]) {
            const v = u.searchParams.get(name);
            if (v) parts.push(v);
        }
        parts.push(u.pathname);
    } catch {
        // 주소로 읽히지 않으면 주소 전체만 지운다
    }
    for (const v of parts) for (const f of forms(v)) out = out.split(f).join("***");
    return out
        .replace(/https?(:|%3A)(\/\/|%2F%2F)[^\s"'<>]+/gi, "[주소 가림]")
        .replace(/(key|token)(=|%3D)[^&\s"']+/gi, "$1=***")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, ERROR_DETAIL_MAX);
}

/** HTML 오류 쪽(구글 앞단의 503 등)은 <title>만, 태그는 뺀다 (CT-11) */
function readableDetail(body: string): string {
    if (/<(!doctype|html|head|body)\b/i.test(body)) {
        const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
        return title.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").trim() || "HTML 오류 쪽";
    }
    return body.replace(/<[^>]+>/g, " ");
}

/** 상태 코드 → 사람이 읽을 한국어 한 줄 (원문은 뒤에 괄호로, CT-11·WPN-9) */
export function chatStatusHint(status: number): string {
    if (status === 401) return "웹훅 주소의 열쇠(key·token)가 맞지 않습니다 — 스페이스에서 웹훅을 새로 만들어 주소를 바꿔야 합니다";
    if (status === 403) return "Workspace 관리자가 웹훅을 막았거나 이 웹훅에 권한이 없습니다 — 스페이스 관리자에게 확인해 주세요";
    if (status === 404) return "스페이스에서 웹훅이 지워졌거나 주소가 틀렸습니다 — 새 웹훅 주소가 필요합니다";
    if (status === 413) return "글이 너무 커서 구글 챗이 받지 않았습니다";
    if (status === 429) return "구글 챗이 잠시 막았습니다 (스페이스당 초당 1통 한도)";
    if (status >= 500) return "구글 챗 쪽 일시 장애";
    if (status === 400) return "구글 챗이 글을 받지 않았습니다 (글 형식 문제)";
    return "구글 챗이 글을 받지 않았습니다";
}

function causeCode(err: unknown): string | null {
    const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
    return cause && typeof cause.code === "string" ? cause.code : null;
}

function isTimeout(err: unknown): boolean {
    return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function describeThrown(err: unknown): string {
    if (err instanceof Error) {
        // undici는 "fetch failed" 밑에 진짜 원인(ECONNRESET 등)을 cause로 둔다
        const cause = (err as Error & { cause?: unknown }).cause;
        const causeText = cause instanceof Error ? ` (${cause.message})` : "";
        return `${err.message}${causeText}`;
    }
    return String(err);
}

type Attempt = GoogleChatResult & { retryAfterMs?: number };

async function postOnce(
    webhookUrl: string,
    body: string,
    fetchImpl: typeof fetch,
    idempotent: boolean
): Promise<Attempt> {
    let res: Response;
    try {
        res = await fetchImpl(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json; charset=UTF-8" },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        if (isTimeout(err)) {
            return {
                ok: false,
                status: null,
                error: `구글 챗 응답이 ${REQUEST_TIMEOUT_MS / 1000}초 안에 오지 않았습니다 — 이미 올라갔을 수 있어 바로 다시 보내지 않습니다`,
                retryable: true,
                uncertain: true,
            };
        }
        const code = causeCode(err);
        const hint =
            code === "ENOTFOUND" || code === "EAI_AGAIN"
                ? "구글 챗 주소를 찾지 못했습니다 (호스트 이름·DNS 확인)"
                : "구글 챗에 연결하지 못했습니다";
        return {
            ok: false,
            status: null,
            error: `${hint} (원인: ${scrub(describeThrown(err), webhookUrl)})`,
            retryable: true,
        };
    }

    // 본문을 읽어 연결을 돌려준다. 실패 응답이면 구글이 준 이유를 짧게 남긴다
    const text = await res.text().catch(() => "");
    if (res.ok) return { ok: true };
    // requestId를 넘긴 요청이 이미 있으면 같은 글이 이미 올라간 것이다
    if (res.status === 409 && idempotent) return { ok: true };

    let detail = text;
    try {
        const parsed = JSON.parse(text) as { error?: { message?: unknown } };
        if (typeof parsed?.error?.message === "string") detail = parsed.error.message;
    } catch {
        detail = readableDetail(text);
    }
    const cleaned = scrub(detail, webhookUrl);
    const out: Attempt = {
        ok: false,
        status: res.status,
        error: `${chatStatusHint(res.status)} (구글 챗 ${res.status}${cleaned ? `: ${cleaned}` : ""})`,
        retryable: isRetryableStatus(res.status),
    };
    if (res.status === 429) {
        const ra = parseRetryAfter(res.headers.get("retry-after"));
        if (ra !== null) out.retryAfterMs = ra;
    }
    return out;
}

function parseRetryAfter(v: string | null): number | null {
    if (!v) return null;
    const t = v.trim();
    if (/^\d+$/.test(t)) return Math.min(RETRY_AFTER_CAP_MS, Number(t) * 1000);
    const at = Date.parse(t);
    if (Number.isFinite(at)) return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, at - Date.now()));
    return null;
}

// ── 스페이스마다 한 줄로 서기 (CT-2) ──
const nextSlotBySpace = new Map<string, number>();

function spaceKey(u: URL): string {
    return `${u.hostname}${u.pathname}`;
}

/** 이 스페이스에 보내도 되는 때까지 기다린다. 자리를 먼저 잡고 기다린다 — 같이 부른 쪽은 그다음 자리를 받는다 */
async function waitSpaceTurn(key: string, intervalMs: number, sleep: (ms: number) => Promise<void>): Promise<void> {
    if (intervalMs <= 0) return;
    const now = Date.now();
    const at = Math.max(now, nextSlotBySpace.get(key) ?? 0);
    nextSlotBySpace.set(key, at + intervalMs);
    if (nextSlotBySpace.size > 500) {
        for (const [k, v] of nextSlotBySpace) if (v < now) nextSlotBySpace.delete(k);
    }
    if (at > now) await sleep(at - now);
}

/** 시험용: 스페이스 줄 서기 기록을 지운다 */
export function resetChatSpaceSlots(): void {
    nextSlotBySpace.clear();
}

/** 같은 스레드로 모으기 (GOOGLE_CHAT_THREADS=on). 웹훅 문서의 thread.threadKey + messageReplyOption */
export function chatThreadsEnabled(env: Record<string, string | undefined>): boolean {
    return (env.GOOGLE_CHAT_THREADS ?? "").trim().toLowerCase() === "on";
}

/** 같은 요청을 한 번만 만들기 (GOOGLE_CHAT_REQUEST_ID=on) — 시간 초과 뒤 다시 보내도 글이 두 번 올라가지 않게 */
export function chatRequestIdEnabled(env: Record<string, string | undefined>): boolean {
    return (env.GOOGLE_CHAT_REQUEST_ID ?? "").trim().toLowerCase() === "on";
}

/**
 * 줄 하나의 requestId (UUID 꼴, 같은 입력이면 늘 같다). 서버 주소(origin)를 넣는다 — 개발·운영 DB의 줄 번호가 같아도
 * 같은 스페이스에서 서로의 글을 "이미 있음"으로 보지 않게
 */
export function chatRequestIdFor(env: Record<string, string | undefined>, family: string, id: number | string): string | undefined {
    if (!chatRequestIdEnabled(env)) return undefined;
    const origin = (env.NEXT_PUBLIC_BASE_URL ?? "").trim() || "https://sendb.kr";
    return uuidFrom(`${origin}|${family}|${id}`);
}

function uuidFrom(input: string): string {
    const hex = createHash("sha1").update(input, "utf8").digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** 어떤 패밀리도 멘션을 쓰지 않는다 — 사용자 값으로 들어온 '<users/…>'(전체 멘션)를 마지막에 막는다 */
export function stripMentions(text: string): string {
    return text.replace(/<users\//gi, "‹users/");
}

/**
 * 구글 챗 웹훅에 text 한 통을 보낸다. 429·5xx·연결 오류면 무작위 지연을 더해 다시 보낸다 (429는 두 번까지, 나머지는 한 번).
 * 시간 초과는 다시 보내지 않는다 (uncertain). 그 이상의 재시도는 워커가 attempts로 10분 뒤에 한다.
 */
export async function postGoogleChatText(
    webhookUrl: string,
    text: string,
    fetchImpl: typeof fetch = fetch,
    opts: ChatPostOptions = {}
): Promise<GoogleChatResult> {
    return postGoogleChatMessage(webhookUrl, { text: stripMentions(text) }, fetchImpl, opts);
}

/** 고객 여정 등 cardsV2 카드도 기존 전송 간격·재시도 정책을 함께 쓴다. */
export async function postGoogleChatMessage(
    webhookUrl: string,
    message: { text: string; cardsV2?: unknown[] },
    fetchImpl: typeof fetch = fetch,
    opts: ChatPostOptions = {}
): Promise<GoogleChatResult> {
    const problem = chatWebhookProblem(webhookUrl);
    if (problem) {
        return { ok: false, status: null, error: chatWebhookProblemText(problem), retryable: false };
    }
    const parsed = new URL(webhookUrl);
    let url = webhookUrl;
    if (opts.threadKey || opts.requestId) {
        const u = new URL(webhookUrl);
        if (opts.threadKey) u.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
        if (opts.requestId) u.searchParams.set("requestId", opts.requestId);
        url = u.toString();
    }
    const payload: { text: string; cardsV2?: unknown[]; thread?: { threadKey: string } } = { ...message, text: stripMentions(message.text) };
    if (opts.threadKey) payload.thread = { threadKey: opts.threadKey.slice(0, 4000) };
    const body = JSON.stringify(payload);

    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const random = opts.random ?? Math.random;
    const interval = opts.spaceIntervalMs ?? SPACE_INTERVAL_MS;
    const key = spaceKey(parsed);
    const base = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const jitter = () => (base > 0 ? Math.floor(random() * RETRY_JITTER_MS) : 0);

    let retries = 0;
    for (;;) {
        await waitSpaceTurn(key, interval, sleep);
        const r = await postOnce(url, body, fetchImpl, Boolean(opts.requestId));
        if (r.ok) return { ok: true };
        const { retryAfterMs, ...result } = r;
        if (!result.retryable || result.uncertain) return result;
        const max = result.status === 429 ? MAX_RETRIES_429 : MAX_RETRIES_OTHER;
        if (retries >= max) return result;
        retries++;
        // 429는 2초·4초, 그 밖에는 1.5초 (시험은 base=0이면 기다리지 않는다)
        const backoff = base <= 0 ? 0 : result.status === 429 ? Math.max(2_000, base) * 2 ** (retries - 1) : base;
        const wait = retryAfterMs !== undefined && base > 0 ? Math.max(retryAfterMs, backoff) : backoff + jitter();
        if (wait > 0) await sleep(wait);
    }
}
