/**
 * 구글 챗 글에 넣는 사용자 값 다듬기 — 순수 함수. DB를 모른다.
 *
 * 구글 챗 글 꾸밈(format-messages)은 *굵게* _기울임_ ~취소선~ `고정폭`, <주소|글> 링크, <users/all> 전체 멘션을 쓰고
 * 맨 URL은 저절로 링크가 된다. 꾸밈 글자를 그대로 보이게 하는 방법(이스케이프)은 문서에 없다 — 그래서 사용자 값
 * (명단·사업·조직 이름, 메모, 고객 발췌)은 꾸밈 글자를 모양이 비슷한 다른 글자로 바꿔 넣는다.
 * 우리가 만든 링크·굵게·인용은 이 함수를 거치지 않는다.
 */

/** 꾸밈 글자 → 모양이 비슷한 전각 글자 (꾸밈으로 읽히지 않는다) */
const MARKUP_LOOKALIKE: Record<string, string> = {
    "*": "＊",
    "~": "～",
    "`": "｀",
    _: "＿",
};

/** 메일 주소 꼴 토막 — 밑줄을 바꾸면 주소가 달라지므로 그대로 둔다 (주소는 구글 챗이 링크로 만들어 꾸밈이 붙지 않는다) */
const EMAIL_TOKEN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function neutralizeMarkup(text: string): string {
    return text
        .split(" ")
        .map((token) => {
            if (EMAIL_TOKEN.test(token)) return token.replace(/[*~`]/g, (c) => MARKUP_LOOKALIKE[c]);
            return token.replace(/[*~`_]/g, (c) => MARKUP_LOOKALIKE[c]);
        })
        .join(" ");
}

/** 맨 URL이 눌리는 링크가 되지 않게 한다 (https:// → hxxps://, www. → www[.]) — 고객이 보낸 피싱 주소가 직원 채팅에서 눌리지 않게 */
function defangUrls(text: string): string {
    return text.replace(/\bhttp(s?):\/\//gi, (_m, s: string) => `hxxp${s}://`).replace(/\bwww\./gi, "www[.]");
}

/** 코드 포인트로 자른다 (이모지 같은 서로게이트 쌍을 반으로 가르지 않는다). 잘렸으면 "…" */
export function clipChars(value: string, max: number): string {
    const chars = Array.from(value);
    return chars.length > max ? chars.slice(0, Math.max(0, max)).join("") + "…" : value;
}

/**
 * 사용자 값 → 구글 챗 한 줄.
 *   `<` `>` → `‹` `›` (링크·멘션 문법이 끼어들지 못하게) · 줄바꿈·공백 묶음 → 공백 하나 (가짜 줄을 만들지 못하게)
 *   * _ ~ ` → 전각 글자 (메일 주소 안의 밑줄은 그대로) · defangUrls면 맨 URL을 눌리지 않게 · max면 코드 포인트로 자름
 */
export function chatSafe(value: unknown, opts: { max?: number; defangUrls?: boolean } = {}): string {
    let out = String(value ?? "")
        .replace(/</g, "‹")
        .replace(/>/g, "›")
        .replace(/\s+/g, " ")
        .trim();
    out = neutralizeMarkup(out);
    if (opts.defangUrls) out = defangUrls(out);
    // 짝 없는 서로게이트(반쪽 이모지)가 들어와도 JSON·DB에서 깨지지 않게
    out = toWellFormedText(out);
    return opts.max !== undefined ? clipChars(out, opts.max) : out;
}

/** 짝 없는 서로게이트를 U+FFFD로 바꾼다 (String.prototype.toWellFormed가 없는 런타임도 쓴다) */
export function toWellFormedText(value: string): string {
    const fn = (String.prototype as { toWellFormed?: () => string }).toWellFormed;
    if (typeof fn === "function") return fn.call(value);
    return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
}
