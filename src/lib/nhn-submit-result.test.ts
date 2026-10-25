import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAlimtalkSubmission, classifyEmailSubmission, isKnownAlimtalkRejection } from "./nhn-submit-result";

test("공급자 시스템 오류와 HTTP·신규 코드의 접수 결과는 자동 재발송 근거가 아니다", () => {
    for (const code of [-9999, -1, 408, 503, 0, 123456]) {
        assert.equal(isKnownAlimtalkRejection(code), false);
        assert.equal(classifyEmailSubmission({ header: { isSuccessful: false, resultCode: code } }), "unknown");
        assert.equal(classifyEmailSubmission({ header: { isSuccessful: true, resultCode: 0 }, data: { requestId: "fake", results: [{ resultCode: code === 0 ? -9999 : code }] } }), "unknown");
    }
    assert.equal(isKnownAlimtalkRejection(-1005), false, "알림톡 중복 idempotency 키는 앞선 접수가 존재할 수 있음");
    assert.equal(isKnownAlimtalkRejection(-1000), true);
});
test("이메일은 개별 접수·요청 ID가 모두 있어야 성공이고 문서상 거절만 실패", () => {
    for (const code of [-1000, -2011, -7101]) assert.equal(classifyEmailSubmission({ header: { isSuccessful: false, resultCode: code } }), "failed");
    const header = { isSuccessful: true, resultCode: 0 };
    assert.equal(classifyEmailSubmission({ header, data: { requestId: "fake", results: [{ resultCode: 0 }] } }), "sent");
    assert.equal(classifyEmailSubmission({ header, data: { results: [{ resultCode: 0 }] } }), "unknown");
    assert.equal(classifyEmailSubmission({ header, data: { requestId: "fake", results: [] } }), "unknown");
    assert.equal(classifyEmailSubmission({ header, data: { requestId: "fake", results: [{ resultCode: -2011 }] } }), "failed");
});
test("UX-174: 알림톡 테스트 발송 — 개별 접수는 pending, 문서상 거절만 failed, 나머지는 unknown", () => {
    const ok = { isSuccessful: true, resultCode: 0 };
    assert.equal(classifyAlimtalkSubmission({ header: ok, message: { requestId: "fake", sendResults: [{ resultCode: 0 }] } }), "pending");
    assert.equal(classifyAlimtalkSubmission({ header: ok, message: { requestId: "fake", sendResults: [{ resultCode: -2018 }] } }), "failed");
    assert.equal(classifyAlimtalkSubmission({ header: ok, message: { requestId: "fake", sendResults: [{ resultCode: -9999 }] } }), "unknown");
    assert.equal(classifyAlimtalkSubmission({ header: ok, message: { sendResults: [{ resultCode: 0 }] } }), "unknown", "요청 ID 없는 접수는 확인 불가");
    assert.equal(classifyAlimtalkSubmission({ header: ok, message: { requestId: "fake", sendResults: [] } }), "unknown");
    assert.equal(classifyAlimtalkSubmission({ header: { isSuccessful: false, resultCode: -1000 } }), "failed");
    assert.equal(classifyAlimtalkSubmission({ header: { isSuccessful: false, resultCode: 503 } }), "unknown");
    assert.equal(classifyAlimtalkSubmission(undefined), "unknown");
});
