/** UX-269: 서명 웹사이트 칸 링크 보정 — 스킴 없는 주소는 https://, http(s)는 예전 출력 그대로, 다른 스킴은 글자만 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { isolateEnv } from "./auth-fake-db.test-helper";

async function load(t: TestContext) {
    isolateEnv(t); // nhn-email은 db 모듈을 읽는다 — 닫힌 포트 주소만 두고 연결은 열지 않는다
    return import("./nhn-email");
}

test("UX-269: 스킴 없는 주소는 https://를 붙이고, 포트·프로토콜 상대 주소도 웹 링크로", async (t) => {
    const { signatureWebsiteHref } = await load(t);
    assert.equal(signatureWebsiteHref("company.com"), "https://company.com");
    assert.equal(signatureWebsiteHref("  www.company.co.kr/about "), "https://www.company.co.kr/about");
    assert.equal(signatureWebsiteHref("shop.example:8080/a"), "https://shop.example:8080/a");
    assert.equal(signatureWebsiteHref("//cdn.example/x"), "https://cdn.example/x");
});

test("UX-269: javascript: 등 다른 스킴은 링크로 만들지 않는다", async (t) => {
    const { signatureWebsiteHref, appendSignature } = await load(t);
    for (const v of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "mailto:a@b.example"]) {
        assert.equal(signatureWebsiteHref(v), null, v);
    }
    const html = appendSignature("<p>본문</p>", JSON.stringify({ name: "김", websites: ["javascript:alert(1)"] }));
    assert(!html.includes('href="javascript:'), "링크가 아니다");
    assert(html.includes("javascript:alert(1)"), "글자로는 보인다");
});

test("UX-269: https://로 시작하는 기존 서명 링크 출력은 바이트 단위로 같다", async (t) => {
    const { appendSignature } = await load(t);
    const url = "https://Company.com/a?b=1&c=2";
    const html = appendSignature("<p>본문</p>", JSON.stringify({ websites: [url] }));
    const escaped = url.replace(/&/g, "&amp;");
    assert(html.includes(`<a href="${escaped}" style="color:#0066cc; text-decoration:none;">${escaped}</a>`));
    const fixed = appendSignature("<p>본문</p>", JSON.stringify({ websites: ["company.com"] }));
    assert(fixed.includes('<a href="https://company.com" style="color:#0066cc; text-decoration:none;">company.com</a>'));
});
