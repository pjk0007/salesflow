import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { docToMarkdown, type DocNode } from "./serialize";
import { parseBlocks } from "../../../lib/rich-text/format";

const t = (text: string, ...marks: (string | [string, string])[]): DocNode => ({
    type: "text",
    text,
    marks: marks.map((m) => (Array.isArray(m) ? { type: m[0], attrs: { href: m[1] } } : { type: m })),
});
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });

describe("편집기 → 본문", () => {
    it("겹친 서식과 공백", () => {
        assert.equal(
            docToMarkdown({
                type: "doc",
                content: [p(t("가 "), t("굵게 ", "bold"), t("둘다", "bold", "italic"), t(" 끝"))],
            }),
        "가 **굵게 *둘다*** 끝");
    });
    it("링크·목록·줄바꿈", () => {
        assert.equal(
            docToMarkdown({
                type: "doc",
                content: [
                    p(t("안내", ["link", "https://a.kr"]), { type: "hardBreak" }, t("다음")),
                    p(),
                    { type: "bulletList", content: [{ type: "listItem", content: [p(t("하나"))] }] },
                    p(),
                ],
            }),
        "[안내](https://a.kr)\n다음\n\n- 하나");
    });
    it("만든 본문을 다시 읽으면 같은 서식", () => {
        const md = docToMarkdown({ type: "doc", content: [p(t("가 "), t("굵게 ", "bold"), t("둘다", "bold", "italic"))] });
        assert.deepEqual(parseBlocks(md), [
            { t: "p", c: [{ t: "text", v: "가 " }, { t: "b", c: [{ t: "text", v: "굵게 " }, { t: "i", c: [{ t: "text", v: "둘다" }] }] }] },
        ]);
    });
});
