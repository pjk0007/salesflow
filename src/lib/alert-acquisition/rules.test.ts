import { test } from "node:test";
import assert from "node:assert/strict";
import { acquisitionText, mailAcquisition, senderDomain, websiteAcquisition, unknownAcquisition, optionalAcquisition } from "./rules";
import { chatAlertMessages } from "../inbox-chat-alerts/message";
import { buildRecordAlertText } from "../record-chat-alert/rules";

test("발신 당시 주소의 도메인과 직접 연결·추정을 구분한다", () => {
    assert.equal(senderDomain(" hello@Domain2.test "), "domain2.test");
    for (const value of [null, "", "<users/all>", "bad@example..com", "https://mail.test/a"]) assert.equal(senderDomain(value), null);
    assert.match(acquisitionText(mailAcquisition("hello@domain2.test", true)), /^메일 · domain2.test \[확인\]/);
    assert.match(acquisitionText(mailAcquisition("hello@domain2.test", false)), /\[추정\].*직접 연결 기록은 없음/);
    assert.match(acquisitionText(mailAcquisition(null, true)), /발신 도메인 미확인/);
});
test("검색 방문에 직접 상담 연결이 있을 때만 확인, UTM과 느슨한 연결은 추정", () => {
    const search = { referrer: "https://www.google.com/search?q=private", landingPage: "https://fictional.test/consult" };
    assert.equal(acquisitionText(websiteAcquisition(search, true)), "홈페이지 · 구글 검색 [확인] — 검색 방문과 상담의 직접 연결 기록 있음");
    assert.equal(websiteAcquisition(search, false).certainty, "inferred");
    assert.equal(websiteAcquisition({ referrer: null, landingPage: search.landingPage + "?utm_source=google" }, true).certainty, "inferred");
    for (const referrer of ["https://google.com.evil.test/", "https://evil.test/?next=google.com", "https://evil.test/google.com"]) {
        assert.equal(websiteAcquisition({ ...search, referrer }, true).certainty, "unknown");
    }
});
test("출처 누락을 직접 유입으로 꾸미지 않고 가짜 메일 표시는 확정하지 않는다", () => {
    assert.equal(acquisitionText(), "유입 미확인 — 판단할 단서 부족");
    assert.deepEqual(websiteAcquisition({ referrer: null, landingPage: null }, true), unknownAcquisition());
    assert.equal(websiteAcquisition({ referrer: null, landingPage: "https://fake.test/?sendb_cid=made-up" }, true).certainty, "inferred");
});
test("부가 조회가 실패해도 원래 알림을 생성할 수 있다", async t => {
    t.mock.method(console, "warn", () => {});
    const result = await optionalAcquisition(async () => { throw new Error("credentials must never appear"); });
    assert.equal(result.certainty, "unknown");
    assert.ok(!acquisitionText(result).includes("credentials"));
});
test("고객 원문과 시스템 링크를 보존하고 유입 설명은 첫 카드에만 넣는다", () => {
    const message = { id: 1, conversationId: "fictional", channelId: 3, name: "가상 고객", channelName: "백오피스랩",
        body: "한글🙂".repeat(4000), createdAt: new Date(), medium: "web", status: "open", attachments: [],
        acquisition: { channel: "<users/all>", certainty: "inferred" as const, evidence: "<script>https://evil.test" } };
    const payloads = chatAlertMessages(message, "https://sendb.kr");
    assert.ok(payloads.length > 1);
    assert.equal(payloads.filter(p => JSON.stringify(p).includes("유입경로")).length, 1);
    assert.ok(!JSON.stringify(payloads).includes("<users/all>"));
    assert.ok(!JSON.stringify(payloads).includes("https://evil.test"));
    for (const payload of payloads) assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 30000);
});
test("도입신청 알림에도 같은 확인·추정 설명을 넣는다", () => {
    const text = buildRecordAlertText({ kind: "created", source: "api", workspaceName: "가상 사업", partitionName: "가상 접수",
        integratedCode: null, fields: [], recordUrl: "https://sendb.kr/records?id=1", acquisition: mailAcquisition("hello@domain2.test", false) });
    assert.match(text, /유입경로: 메일 · domain2.test \[추정\]/);
    assert.match(text, /<https:\/\/sendb.kr\/records\?id=1\|샌드비에서 보기>/);
});
