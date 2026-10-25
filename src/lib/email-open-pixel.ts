import { createHmac, timingSafeEqual } from "node:crypto";

export interface OpenPixelOptions { secret?: string; baseUrl?: string }

/** 正規 십진 양수 int4만 허용한다. */
export function parseOpenId(raw: string | null | undefined): number | null {
    if (!raw || !/^[1-9][0-9]{0,9}$/.test(raw)) return null;
    const id = Number(raw);
    return id <= 2147483647 ? id : null;
}

/** 추적 주소 서명 — 용도(purpose)마다 비밀값에서 키를 나눠 쓴다. 오픈 픽셀과 클릭 링크가 같은 방식이다 */
function trackingSignature(purpose: string, payload: string, secret: string, length: number): string {
    const key = createHmac("sha256", secret).update(purpose).digest();
    return createHmac("sha256", key).update(payload).digest("base64url").slice(0, length);
}

export function openSignature(sendLogId: number, secret: string): string {
    return trackingSignature("sendb/email-open-pixel/v1", `open:${sendLogId}`, secret, 16);
}

/** 클릭 추적 링크 서명 — 발송 id와 도착 주소를 함께 묶는다. 둘 중 하나라도 바꾸면 맞지 않는다 (UX-271) */
export function clickSignature(sendLogId: number, url: string, secret: string): string {
    return trackingSignature("sendb/email-click/v1", `click:${sendLogId}:${url}`, secret, 22);
}

export function verifyClickSignature(
    sendLogId: number,
    url: string,
    signature: string | null | undefined,
    secret = process.env.JWT_SECRET
): boolean {
    if (!secret || !signature || !/^[A-Za-z0-9_-]{22}$/.test(signature)) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(clickSignature(sendLogId, url, secret)));
}

export function verifyOpenSignature(sendLogId: number, signature: string | null | undefined, secret = process.env.JWT_SECRET): boolean {
    if (!secret || !signature || !/^[A-Za-z0-9_-]{16}$/.test(signature)) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(openSignature(sendLogId, secret)));
}

export function verifiedOpenId(params: URLSearchParams, secret = process.env.JWT_SECRET): number | null {
    const id = parseOpenId(params.get("id"));
    return id !== null && verifyOpenSignature(id, params.get("s"), secret) ? id : null;
}

/** 환경 변수는 호출 때 읽으며, secret이 비면 발송 전에 오류를 던진다. */
export function openPixelUrl(sendLogId: number, opts: OpenPixelOptions = {}): string {
    const secret = opts.secret ?? process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET 환경 변수가 설정되지 않았습니다.");
    const baseUrl = opts.baseUrl ?? (process.env.NEXT_PUBLIC_BASE_URL || "https://sendb.kr");
    return `${baseUrl}/api/track/open?id=${sendLogId}&s=${openSignature(sendLogId, secret)}`;
}

export function openPixelTag(sendLogId: number, opts?: OpenPixelOptions): string {
    const url = openPixelUrl(sendLogId, opts).replaceAll("&", "&amp;");
    return `<img src="${url}" width="1" height="1" alt="" border="0" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0" />`;
}

const BODY_OPEN_RE = /<body\b[^>]*>/i;
const PROLOG_RE = /^\s*(?:<!doctype[^>]*>\s*)?(?:<html\b[^>]*>\s*)?(?:<head\b[^>]*>[\s\S]*?<\/head>\s*)?/i;
/** 첫 body 시작 태그 바로 뒤, 없으면 머리말 뒤에 픽셀을 하나 삽입한다. */
export function appendOpenPixel(html: string, sendLogId: number, opts?: OpenPixelOptions): string {
    const body = BODY_OPEN_RE.exec(html);
    const at = body ? body.index + body[0].length : (PROLOG_RE.exec(html)?.[0].length ?? 0);
    return html.slice(0, at) + openPixelTag(sendLogId, opts) + html.slice(at);
}

export const PIXEL_GIF = new Uint8Array([
    0x47,0x49,0x46,0x38,0x39,0x61, 0x01,0x00,0x01,0x00, 0x80,0x00,0x00,
    0x00,0x00,0x00, 0xff,0xff,0xff,
    0x21,0xf9,0x04,0x01,0x00,0x00,0x00,0x00,
    0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,
    0x02,0x02,0x44,0x01,0x00,
    0x3b,
]);
export const PIXEL_HEADERS = {
    "Content-Type": "image/gif",
    "Content-Length": "43",
    "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
    "Pragma": "no-cache",
    "Expires": "Thu, 01 Jan 1970 00:00:00 GMT",
    "X-Content-Type-Options": "nosniff",
} as const;   // Set-Cookie 없음
