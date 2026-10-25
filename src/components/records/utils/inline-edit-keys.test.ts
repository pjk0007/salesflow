import test from "node:test";
import assert from "node:assert/strict";
import { inlineEditKeyAction } from "./inline-edit-keys";

test("UX-058 긴 텍스트 인라인 편집: Enter는 줄바꿈, Ctrl/⌘+Enter 저장, Esc 취소, 조합 중 Enter 무시", () => {
    assert.equal(inlineEditKeyAction(true, { key: "Enter" }), null);
    assert.equal(inlineEditKeyAction(true, { key: "Enter", ctrlKey: true }), "save");
    assert.equal(inlineEditKeyAction(true, { key: "Enter", metaKey: true }), "save");
    assert.equal(inlineEditKeyAction(true, { key: "Escape" }), "cancel");
    assert.equal(inlineEditKeyAction(true, { key: "Enter", ctrlKey: true, nativeEvent: { isComposing: true } }), null);
});

test("한 줄 입력: Enter 저장, Esc 취소, 한글 조합 중 Enter는 저장하지 않음", () => {
    assert.equal(inlineEditKeyAction(false, { key: "Enter" }), "save");
    assert.equal(inlineEditKeyAction(false, { key: "Escape" }), "cancel");
    assert.equal(inlineEditKeyAction(false, { key: "Enter", nativeEvent: { keyCode: 229 } }), null);
    assert.equal(inlineEditKeyAction(false, { key: "a" }), null);
});
