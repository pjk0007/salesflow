import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInline, toPlainText, toEditorHtml } from "./format";

describe("상담 메시지 서식", () => {
    it("굵게·기울임·코드·링크를 읽는다", () => {
        assert.deepEqual(parseInline("a **b** *c* `d` [e](https://x.com)"), [
            { t: "text", v: "a " },
            { t: "b", c: [{ t: "text", v: "b" }] },
            { t: "text", v: " " },
            { t: "i", c: [{ t: "text", v: "c" }] },
            { t: "text", v: " " },
            { t: "code", v: "d" },
            { t: "text", v: " " },
            { t: "link", href: "https://x.com", c: [{ t: "text", v: "e" }] },
        ]);
    });
    it("굵고 기울인 글자", () => {
        assert.deepEqual(parseInline("***b***"), [{ t: "b", c: [{ t: "i", c: [{ t: "text", v: "b" }] }] }]);
    });
    it("짝 없는 별표는 그대로", () => {
        assert.equal(toPlainText("*위 경로에서 변경 가능"), "*위 경로에서 변경 가능");
        assert.equal(toPlainText("2 * 3 = 6"), "2 * 3 = 6");
    });
    it("메일용 글자: 링크는 글자 (주소), 목록 유지", () => {
        assert.equal(toPlainText("**안내**\n- [여기](https://a.kr)\n- https://b.kr."), "안내\n- 여기 (https://a.kr)\n- https://b.kr.");
    });
    it("편집기 HTML은 태그를 이스케이프한다", () => {
        assert.equal(toEditorHtml("<b>x</b>\n- y"), "<p>&lt;b&gt;x&lt;/b&gt;</p><ul><li><p>y</p></li></ul>");
    });
    it("javascript 주소는 링크로 읽지 않는다", () => {
        assert.deepEqual(parseInline("[x](javascript:alert(1))")[0], { t: "text", v: "[x](javascript:alert(1))" });
    });
});
