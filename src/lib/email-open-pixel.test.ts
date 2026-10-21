import test from "node:test";
import assert from "node:assert/strict";
import { appendOpenPixel, openPixelTag, openPixelUrl, openSignature, parseOpenId, PIXEL_GIF, PIXEL_HEADERS, verifiedOpenId, verifyOpenSignature } from "./email-open-pixel";

const opts = { secret: "test-secret", baseUrl: "https://t.example" };
test("B3: id는 정규 십진 int4 양수만 허용", () => {
    assert.equal(parseOpenId("1"), 1);
    assert.equal(parseOpenId("2147483647"), 2147483647);
    for (const raw of ["2147483648", "0", "-1", "01", "1.0", "1e3", " 1", "abc", "", null, undefined]) {
        assert.equal(parseOpenId(raw), null);
    }
});
test("B3: 서명은 id·키에 귀속되고 변조·누락은 거부", () => {
    const sig = openSignature(123, opts.secret);
    assert.match(sig, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(openSignature(123, opts.secret), sig);
    assert.notEqual(openSignature(124, opts.secret), sig);
    assert.notEqual(openSignature(123, "other"), sig);
    assert.equal(verifyOpenSignature(123, sig, opts.secret), true);
    for (const invalid of [sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"), "", null, sig + "A"]) {
        assert.equal(verifyOpenSignature(123, invalid, opts.secret), false);
    }
    assert.equal(verifyOpenSignature(124, sig, opts.secret), false);
    assert.equal(verifyOpenSignature(123, sig, "other"), false);
    assert.equal(verifyOpenSignature(123, sig, ""), false);
    assert.equal(verifiedOpenId(new URLSearchParams(`id=123&s=${sig}`), opts.secret), 123);
    for (const query of ["id=123", `s=${sig}`, `id=abc&s=${sig}`, `id=0123&s=${sig}`]) {
        assert.equal(verifiedOpenId(new URLSearchParams(query), opts.secret), null);
    }
});
test("B1·B3: URL과 태그 계약", () => {
    const url = `https://t.example/api/track/open?id=123&s=${openSignature(123, opts.secret)}`;
    assert.equal(openPixelUrl(123, opts), url);
    assert.equal(openPixelTag(123, opts), `<img src="${url.replaceAll("&", "&amp;")}" width="1" height="1" alt="" border="0" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0" />`);
    assert.doesNotMatch(openPixelTag(123, opts), /<a\s/i);
    assert.throws(() => openPixelUrl(123, { ...opts, secret: "" }), /JWT_SECRET 환경 변수가 설정되지 않았습니다\./);
});
test("B1: 본문 앞 또는 머리말 뒤에 하나만 삽입하고 원문 보존", () => {
    const cases: [string, string][] = [
        ["<p>안녕</p>", ""],
        ['<html><body style="margin:0"><p>x</p></body></html>', '<html><body style="margin:0">'],
        ["<HTML><BODY><p>x</p></BODY></HTML>", "<HTML><BODY>"],
        ["<!DOCTYPE html><html><head><title>t</title></head><div>x</div></html>", "<!DOCTYPE html><html><head><title>t</title></head>"],
        ["<!doctype html><div>x</div>", "<!doctype html>"],
        ["<html><div>x</div></html>", "<html>"], ["<body><p>a</p><body>", "<body>"], ["<bodyx>t", ""], ["", ""],
    ];
    const tag = openPixelTag(123, opts);
    for (const [input, prefix] of cases) {
        const out = appendOpenPixel(input, 123, opts);
        assert.equal(out.indexOf(tag), prefix.length);
        assert.equal(out.split("/api/track/open?").length, 2);
        assert.equal(out.replace(tag, ""), input);
    }
});
test("B2: 기존 클릭 링크 보존", () => {
    const input = '<a href="https://sendb.kr/api/track/click?id=7&url=https%3A%2F%2Fa.example">x</a>';
    assert.equal(appendOpenPixel(input, 123, opts), openPixelTag(123, opts) + input);
});
test("B6: 43바이트 투명 GIF와 캐시 금지 헤더", () => {
    assert.equal(PIXEL_GIF.length, 43);
    assert.equal(Buffer.from(PIXEL_GIF.slice(0, 6)).toString(), "GIF89a");
    assert.equal(PIXEL_GIF[22] & 1, 1);
    assert.equal(PIXEL_GIF[25], 0);
    assert.equal(Buffer.from(PIXEL_GIF).toString("base64"), "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==");
    assert.equal(PIXEL_HEADERS["Content-Type"], "image/gif");
    assert.equal(PIXEL_HEADERS["Content-Length"], "43");
    assert.match(PIXEL_HEADERS["Cache-Control"], /no-store/);
    assert.equal(new Headers(PIXEL_HEADERS).has("Set-Cookie"), false);
});
