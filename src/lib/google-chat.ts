/**
 * 구글 챗 수신 웹훅으로 글 한 통 보내기. DB를 모른다.
 *
 * 웹훅 주소는 그 자체가 비밀값이다 (주소의 key·token만 있으면 누구나 그 스페이스에 쓸 수 있다).
 * 그래서 돌려주는 오류 글에 주소·쿼리를 절대 넣지 않는다 — 오류 글은 deep_visitor_alerts.last_error와
 * 관리자 목록 응답에 그대로 남는다.
 */

export type GoogleChatResult =
    | { ok: true }
    | { ok: false; status: number | null; error: string; retryable: boolean };

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 1_500;
const ERROR_DETAIL_MAX = 200;

function isRetryableStatus(status: number): boolean {
    // 400·401·403·404는 주소나 글이 잘못된 것이라 다시 보내도 같다
    return status === 429 || status >= 500;
}

/** 오류 글에서 웹훅 주소와 그 조각(key·token)을 지운다 */
function scrub(message: string, webhookUrl: string): string {
    let out = message;
    if (webhookUrl) out = out.split(webhookUrl).join("[웹훅 주소]");
    return out
        .replace(/https?:\/\/[^\s"'<>]+/gi, "[주소 가림]")
        .replace(/\b(key|token)=[^&\s"']+/gi, "$1=***")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, ERROR_DETAIL_MAX);
}

function describeThrown(err: unknown): string {
    if (err instanceof Error) {
        if (err.name === "TimeoutError" || err.name === "AbortError") {
            return `응답 시간 초과 (${REQUEST_TIMEOUT_MS / 1000}초)`;
        }
        // undici는 "fetch failed" 밑에 진짜 원인(ECONNRESET 등)을 cause로 둔다
        const cause = (err as Error & { cause?: unknown }).cause;
        const causeText = cause instanceof Error ? ` (${cause.message})` : "";
        return `${err.message}${causeText}`;
    }
    return String(err);
}

async function postOnce(webhookUrl: string, text: string, fetchImpl: typeof fetch): Promise<GoogleChatResult> {
    let res: Response;
    try {
        res = await fetchImpl(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        return {
            ok: false,
            status: null,
            error: `구글 챗 연결 실패: ${scrub(describeThrown(err), webhookUrl)}`,
            retryable: true,
        };
    }

    // 본문을 읽어 연결을 돌려준다. 실패 응답이면 구글이 준 이유를 짧게 남긴다
    const body = await res.text().catch(() => "");
    if (res.ok) return { ok: true };

    let detail = body;
    try {
        const parsed = JSON.parse(body) as { error?: { message?: unknown } };
        if (typeof parsed?.error?.message === "string") detail = parsed.error.message;
    } catch {
        // JSON이 아니면 본문 앞부분을 그대로 쓴다
    }
    const cleaned = scrub(detail, webhookUrl);
    return {
        ok: false,
        status: res.status,
        error: cleaned ? `구글 챗 응답 ${res.status}: ${cleaned}` : `구글 챗 응답 ${res.status}`,
        retryable: isRetryableStatus(res.status),
    };
}

/**
 * 구글 챗 웹훅에 text 한 통을 보낸다. 429·5xx·연결 오류면 한 번만 다시 보낸다.
 * 그 이상의 재시도는 워커가 attempts로 10분 뒤에 한다 (한 회차가 웹훅 하나에 오래 묶이지 않게).
 */
export async function postGoogleChatText(
    webhookUrl: string,
    text: string,
    fetchImpl: typeof fetch = fetch,
    opts: { retryDelayMs?: number } = {}
): Promise<GoogleChatResult> {
    let parsed: URL | null = null;
    try {
        parsed = new URL(webhookUrl);
    } catch {
        parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:") {
        return { ok: false, status: null, error: "웹훅 주소 형식이 잘못되었습니다 (https 주소가 아님)", retryable: false };
    }

    const first = await postOnce(webhookUrl, text, fetchImpl);
    if (first.ok || !first.retryable) return first;

    await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
    return postOnce(webhookUrl, text, fetchImpl);
}
