import { test } from "node:test";
import assert from "node:assert/strict";
import { isScriptUrl, sanitizeElements, sanitizeEmailHtml, type SanitizableElement } from "./sanitizeEmailHtml";

/** 브라우저 Element 대신 쓰는 작은 가상 요소 — 지운 속성·요소를 기록한다 */
function el(tagName: string, attrs: Record<string, string>) {
    const attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
    const node = {
        tagName,
        attributes,
        removed: false,
        removeAttribute(name: string) {
            const i = attributes.findIndex((a) => a.name === name);
            if (i >= 0) attributes.splice(i, 1);
        },
        remove() {
            node.removed = true;
        },
    };
    return node satisfies SanitizableElement;
}

test("UX-232: on* 이벤트 속성·srcdoc·스크립트 주소는 빼고 메일 서식은 남긴다", () => {
    const img = el("IMG", { src: "https://cdn.example/a.png", alt: "로고", onerror: "fetch('/api/org/settings')", style: "width:100px" });
    const link = el("A", { href: "javascript:alert(1)", target: "_blank", ONCLICK: "x()" });
    const safeLink = el("A", { href: "https://shop.example/?a=1&b=2", title: "상품" });
    const table = el("TABLE", { border: "0", cellpadding: "4", style: "border-collapse:collapse" });
    const frameish = el("DIV", { srcdoc: "<script>x</script>", "data-x": "1" });
    sanitizeElements([img, link, safeLink, table, frameish]);
    assert.deepEqual(img.attributes.map((a) => a.name), ["src", "alt", "style"]);
    assert.deepEqual(link.attributes.map((a) => a.name), ["target"]);
    assert.deepEqual(safeLink.attributes.map((a) => a.name), ["href", "title"]);
    assert.deepEqual(table.attributes.map((a) => a.name), ["border", "cellpadding", "style"]);
    assert.deepEqual(frameish.attributes.map((a) => a.name), ["data-x"]);
});

test("UX-232: script·iframe·object·embed·base 요소는 통째로 지운다", () => {
    const nodes = ["SCRIPT", "iframe", "OBJECT", "embed", "BASE", "P", "IMG"].map((t) => el(t, {}));
    sanitizeElements(nodes);
    assert.deepEqual(nodes.filter((n) => n.removed).map((n) => n.tagName.toLowerCase()), ["script", "iframe", "object", "embed", "base"]);
});

test("UX-232: 대소문자·공백·제어 문자를 섞은 스크립트 주소도 막고, 보통 주소·##변수##는 그대로", () => {
    for (const v of ["JavaScript:alert(1)", " javascript:x", "java\tscript:x", "java\nscript:x", "\u0001javascript:x", "vbscript:msgbox", "DATA:text/html;base64,PHNjcmlwdD4="]) {
        assert.equal(isScriptUrl(v), true, JSON.stringify(v));
    }
    for (const v of ["https://a.example", "mailto:a@b.example", "##ctaUrl##", "data:image/png;base64,AAAA", "/relative/path"]) {
        assert.equal(isScriptUrl(v), false, v);
    }
});

test("UX-232: 문서가 없는 곳(서버)에서는 원문 그대로 — 저장 값은 바꾸지 않는다", () => {
    const html = '<p onclick="x()">안녕하세요 ##name##님</p>';
    assert.equal(sanitizeEmailHtml(html), html);
    assert.equal(sanitizeEmailHtml(""), "");
});
