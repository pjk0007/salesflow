import test from "node:test";
import assert from "node:assert/strict";
import { decodeCsvText } from "./csv-text";

test("UX-069 UTF-8·BOM·한국어 Excel CSV가 같은 한글을 보존한다", () => {
    const text = "이름,회사\n홍길동,샌드비";
    assert.equal(decodeCsvText(new TextEncoder().encode(text)), text);
    assert.equal(decodeCsvText(new TextEncoder().encode(`\uFEFF${text}`)), text);
    assert.equal(decodeCsvText(Uint8Array.from([0xc0, 0xcc, 0xb8, 0xa7])), "이름");
    assert.throws(() => decodeCsvText(Uint8Array.of(0xff)), /인코딩/);
});
