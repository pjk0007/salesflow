/**
 * NHN Cloud Email eachMail의 사용자 지정 헤더(customHeaders) 거르기 — 순수 함수만 (DB·네트워크를 모른다).
 *
 * NHN 콘솔 안내(사용자 지정 헤더): 이름은 영문·숫자·하이픈 1~50자, 값은 1~1000바이트, 아래 이름은 쓸 수 없다.
 * 하나라도 어기면 NHN은 그 메일 전체를 거절한다 ("The 'customHeaders' contains an invalid name or body.").
 * 2026-10-04 개발 서버 실제 발송에서 워크스페이스 답장 주소(Reply-To) 하나 때문에 그 사업의 모든 메일이 실패했다
 * (docs/2026-10-02-sender-warmup/DESIGN-3-reply-to.md 6절 "실제 발송 결과(2026-10-04)와 바뀐 결정").
 *
 * 그래서 NHN에 보내기 직전 한 곳(NhnEmailClient.sendEachMail)에서 거른다 — 잘못된 헤더 하나가 메일을 막지 않게
 * 그 헤더만 빼고 보낸다. 맞는 헤더(List-Unsubscribe·List-Unsubscribe-Post)는 이름·값을 바꾸지 않는다.
 */

/** NHN이 사용자 지정 헤더로 받지 않는 이름 (NHN 콘솔 안내 그대로, 대소문자 구분 없이 막는다) */
export const NHN_FORBIDDEN_CUSTOM_HEADERS: readonly string[] = [
    "From",
    "To",
    "Cc",
    "Bcc",
    "Date",
    "Subject",
    "Content-Disposition",
    "Message-ID",
    "Sender",
    "Reply-To",
    "Newsgroups",
    "Content-ID",
    "Content-MD5",
    "MIME-Version",
    "Content-Transfer-Encoding",
    "Content-Description",
    "In-Reply-To",
    "References",
];

/** 헤더 값의 최대 길이 (UTF-8 바이트) */
export const NHN_CUSTOM_HEADER_VALUE_MAX_BYTES = 1000;

const FORBIDDEN = new Set(NHN_FORBIDDEN_CUSTOM_HEADERS.map((n) => n.toLowerCase()));
const NAME_RE = /^[A-Za-z0-9-]{1,50}$/;
/** 줄바꿈·NUL이 든 값은 헤더를 깨거나 다른 헤더를 끼워 넣는다 */
const UNSAFE_VALUE_RE = /[\r\n\0]/;

export type DroppedHeaderReason = "forbidden" | "invalid-name" | "invalid-value" | "duplicate";

export interface DroppedHeader {
    name: string;
    reason: DroppedHeaderReason;
}

export interface SanitizedCustomHeaders {
    /** 보낼 헤더. 남은 것이 없으면 칸 자체가 없다 — 요청에 customHeaders를 싣지 않는다 */
    customHeaders?: Record<string, string>;
    /** 뺀 헤더 (값은 담지 않는다 — 수신거부 토큰 같은 값이 로그에 남지 않게) */
    dropped: DroppedHeader[];
}

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

function checkValue(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0) return false;
    if (UNSAFE_VALUE_RE.test(value)) return false;
    return utf8ByteLength(value) <= NHN_CUSTOM_HEADER_VALUE_MAX_BYTES;
}

/**
 * NHN이 거절할 헤더를 뺀다. 순서·이름·값은 그대로 둔다.
 * - 금지 이름(대소문자 무관) → forbidden
 * - 이름 형식(영문·숫자·하이픈 1~50자)이 아님 → invalid-name
 * - 값이 문자열이 아니거나 비었거나 1000바이트를 넘거나 줄바꿈·NUL이 있음 → invalid-value
 * - 대소문자만 다른 같은 이름이 또 나옴 → duplicate (먼저 나온 것을 남긴다)
 */
export function sanitizeNhnCustomHeaders(headers: Readonly<Record<string, unknown>> | null | undefined): SanitizedCustomHeaders {
    const out: Record<string, string> = {};
    const dropped: DroppedHeader[] = [];
    const seen = new Set<string>();
    for (const [name, value] of Object.entries(headers ?? {})) {
        if (!NAME_RE.test(name)) {
            dropped.push({ name, reason: "invalid-name" });
            continue;
        }
        const key = name.toLowerCase();
        if (FORBIDDEN.has(key)) {
            dropped.push({ name, reason: "forbidden" });
            continue;
        }
        if (!checkValue(value)) {
            dropped.push({ name, reason: "invalid-value" });
            continue;
        }
        if (seen.has(key)) {
            dropped.push({ name, reason: "duplicate" });
            continue;
        }
        seen.add(key);
        out[name] = value;
    }
    return Object.keys(out).length > 0 ? { customHeaders: out, dropped } : { dropped };
}

/** 같은 경고를 프로세스에서 몇 가지까지 남길지 — 이상한 이름이 끝없이 들어와도 기억이 커지지 않게 */
const WARN_KEYS_MAX = 200;

/**
 * 뺀 헤더 경고를 (이름, 까닭)마다 한 번만 남기는 함수를 만든다 — 같은 버그가 메일마다 로그를 채우지 않게.
 * 이름은 60자까지만 적는다. 값은 적지 않는다.
 */
export function createDroppedHeaderWarner(log: (message: string) => void): (dropped: readonly DroppedHeader[]) => void {
    const warned = new Set<string>();
    return (dropped) => {
        for (const d of dropped) {
            const key = `${d.reason}:${d.name.toLowerCase()}`;
            if (warned.has(key) || warned.size >= WARN_KEYS_MAX) continue;
            warned.add(key);
            log(
                `[nhn-email] NHN이 거절하는 사용자 지정 헤더를 빼고 보냅니다: ${JSON.stringify(d.name.slice(0, 60))} (${d.reason}). ` +
                    "같은 헤더는 다시 알리지 않습니다."
            );
        }
    };
}

/**
 * NHN에 보낼 발송 요청의 customHeaders를 거른다 (NhnEmailClient.sendEachMail이 보내기 직전에 부른다).
 * - customHeaders 칸이 없으면 받은 요청 그대로
 * - 뺄 것이 없으면 받은 요청 그대로 — 요청 본문이 바이트까지 같다 (List-Unsubscribe만 있는 지금의 메일)
 * - 뺀 것이 있으면 warn에 알리고, 남은 헤더만 싣는다. 남은 것이 없으면(빈 객체 포함) customHeaders 칸을 싣지 않는다
 */
export function withSafeCustomHeaders<T extends { customHeaders?: Readonly<Record<string, unknown>> | null }>(
    data: T,
    warn: (dropped: readonly DroppedHeader[]) => void
): T {
    if (data.customHeaders === undefined) return data;
    const { customHeaders, ...rest } = data;
    const sanitized = sanitizeNhnCustomHeaders(customHeaders);
    if (sanitized.dropped.length === 0 && sanitized.customHeaders) return data;
    if (sanitized.dropped.length > 0) warn(sanitized.dropped);
    return (sanitized.customHeaders ? { ...rest, customHeaders: sanitized.customHeaders } : rest) as T;
}
