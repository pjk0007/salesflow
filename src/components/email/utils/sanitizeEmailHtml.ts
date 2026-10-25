/**
 * 템플릿 본문 HTML을 앱 화면(비주얼 편집 영역·미리보기)에 넣기 전에 스크립트가 돌 수 있는 부분을 뺀다 (UX-232).
 * 다른 직원이 저장했거나 붙여 넣은·AI가 만든 본문의 `<img onerror=…>`가 연 사람의 로그인 세션으로 실행되지 않게 한다.
 *
 * 빼는 것: 스크립트·다른 문서를 싣는 태그(script·iframe·object 등), on* 이벤트 속성, srcdoc,
 * javascript:/vbscript:/data:text/html 주소. 표·이미지·링크·인라인 스타일 같은 메일 서식은 그대로 둔다.
 * 서버 저장 값은 바꾸지 않는다 — 코드 모드 원문은 그대로이고, 비주얼 모드로 고친 본문만 정화된 채 저장된다.
 */

const BLOCKED_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "base"]);
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "background", "poster", "data", "lowsrc", "dynsrc"]);

/** 정화에 필요한 요소 모양 (브라우저 Element의 일부) */
export interface SanitizableElement {
    tagName: string;
    readonly attributes: ArrayLike<{ name: string; value: string }>;
    removeAttribute(name: string): void;
    remove(): void;
}

/** 주소 값이 스크립트를 실행하는가 — 대소문자·공백·제어 문자를 섞은 우회도 막는다 */
export function isScriptUrl(value: string): boolean {
    // 공백·제어 문자(U+0000~U+0020)를 빼고 본다 — 브라우저도 주소 안의 탭·줄바꿈과 앞쪽 제어 문자를 무시한다
    const compact = Array.from(value)
        .filter((ch) => ch.codePointAt(0)! > 0x20)
        .join("")
        .toLowerCase();
    return compact.startsWith("javascript:") || compact.startsWith("vbscript:") || compact.startsWith("data:text/html");
}

/** 요소 목록을 정화한다 (트리 순서대로 받은 모든 요소). 막힌 태그는 통째로 지운다 */
export function sanitizeElements(elements: Iterable<SanitizableElement>): void {
    for (const el of elements) {
        if (BLOCKED_TAGS.has(el.tagName.toLowerCase())) {
            el.remove();
            continue;
        }
        for (const { name, value } of Array.from(el.attributes)) {
            const attr = name.toLowerCase();
            if (attr.startsWith("on") || attr === "srcdoc" || (URL_ATTRIBUTES.has(attr) && isScriptUrl(value))) {
                el.removeAttribute(name);
            }
        }
    }
}

/**
 * 브라우저에서 HTML 문자열을 정화해 돌려준다. `<template>`의 내용은 비활성 문서라 파싱하는 동안 스크립트·이미지가
 * 돌거나 불러와지지 않는다. 서버(문서 없음)에서는 그대로 돌려준다 — 이 함수는 화면 전용이다.
 */
export function sanitizeEmailHtml(html: string): string {
    if (!html || typeof document === "undefined") return html;
    const template = document.createElement("template");
    template.innerHTML = html;
    sanitizeElements(Array.from(template.content.querySelectorAll("*")));
    return template.innerHTML;
}
