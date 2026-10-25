import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { splitTemplateVariables } from "@/lib/alimtalk-template-utils";
import { HighlightedTemplateText } from "./TemplatePreview";

test("UX-186: 미리보기 조각 — 텍스트·변수 순서와 원문 보존", () => {
    const text = '<b>안내</b> & "따옴표" #{이름}님\n#{금액}원';
    const parts = splitTemplateVariables(text);
    assert.equal(parts.map((p) => p.text).join(""), text);
    assert.deepEqual(parts.filter((p) => p.variable).map((p) => p.text), ["#{이름}", "#{금액}"]);
    assert.deepEqual(splitTemplateVariables(""), []);
    assert.deepEqual(splitTemplateVariables("변수 없음"), [{ text: "변수 없음", variable: false }]);
});

test("UX-186: HTML 형태 문자열은 태그로 해석하지 않고 그대로 텍스트로 보인다", () => {
    const html = renderToStaticMarkup(createElement(HighlightedTemplateText, { text: '<img src=x onerror="alert(1)"><b>안내</b> #{이름}' }));
    assert.ok(!html.includes("<img"), html);
    assert.ok(!html.includes("<b>"), html);
    assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;b&gt;안내&lt;/b&gt;"), html);
    assert.match(html, /<span class="[^"]*bg-yellow-200[^"]*">#\{이름\}<\/span>/);
});
