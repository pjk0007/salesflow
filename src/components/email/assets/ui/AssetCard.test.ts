// UX-150 — 선택 모드 카드는 키보드로 조작 가능한 네이티브 button(선택 상태 aria-pressed), 관리 모드는 중첩 버튼 없는 div.
// 실제 React 렌더 결과(정적 마크업)를 확인한다. 브라우저 포커스·키 입력 실측은 별도다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AssetCard from "./AssetCard";

const asset = { id: 7, name: "배너.png", url: "https://example.test/banner.png" } as never;

test("UX-150: 선택 모드는 button·aria-pressed·이름, 포커스 표시", () => {
    const off = renderToStaticMarkup(createElement(AssetCard, { asset, selected: false, onClick: () => {} }));
    assert.match(off, /<button type="button" aria-pressed="false" aria-label="배너.png"/);
    assert.match(off, /focus-visible:ring-2/);
    const on = renderToStaticMarkup(createElement(AssetCard, { asset, selected: true, onClick: () => {} }));
    assert.match(on, /aria-pressed="true"/);
});

test("UX-150: 관리 모드(footer)는 div라 안의 버튼이 중첩되지 않는다", () => {
    const html = renderToStaticMarkup(createElement(AssetCard, { asset, footer: createElement("button", { type: "button" }, "삭제") }));
    assert.match(html, /<div class="group/);
    assert.doesNotMatch(html, /<button type="button" aria/);
    assert.doesNotMatch(html, /aria-pressed/);
    assert.match(html, /alt="배너.png"/);
});
