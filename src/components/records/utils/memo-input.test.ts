import test from "node:test";
import assert from "node:assert/strict";
import { isMemoSubmitKey } from "./memo-input";

test("UX-059 메모 Enter 저장: 한글 조합 중 Enter·Shift+Enter는 저장하지 않는다", () => {
    const key = (k: string, shiftKey = false, nativeEvent: { isComposing?: boolean; keyCode?: number } = {}) =>
        isMemoSubmitKey({ key: k, shiftKey, nativeEvent });
    assert.equal(key("Enter"), true);
    assert.equal(key("Enter", true), false, "Shift+Enter는 줄바꿈");
    assert.equal(key("Enter", false, { isComposing: true }), false, "조합 중 Enter");
    assert.equal(key("Enter", false, { keyCode: 229 }), false, "Safari 등 조합 확정 Enter(keyCode 229)");
    assert.equal(key("a"), false);
});
