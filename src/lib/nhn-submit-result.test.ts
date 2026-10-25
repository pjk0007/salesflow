import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEmailSubmission, isKnownAlimtalkRejection } from "./nhn-submit-result";

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

// UX-160 — NHN 실패를 영문 내부 문구 없이 한국어로 안내한다
test("NHN 실패 안내: HTTP 401·403·404·429·500, 결과 코드, 수신자 거절, 수신거부 확인", async () => {
    const { nhnEmailFailureMessage } = await import("./nhn-submit-result");
    const { EMAIL_SEND_BLOCKED } = await import("./email-send-guard");
    const http = (code: number, text: string) => ({ header: { isSuccessful: false, resultCode: code, resultMessage: `HTTP ${code}: ${text}` }, data: null });
    for (const code of [401, 403]) assert.match(nhnEmailFailureMessage(http(code, "Unauthorized"), "연결 확인"), /^NHN 인증에 실패해 연결 확인하지 못했습니다\. .*App Key와 Secret Key/);
    assert.match(nhnEmailFailureMessage(http(404, "Not Found")), /App Key를 확인/);
    assert.match(nhnEmailFailureMessage(http(429, "Too Many Requests")), /잠시 후 다시 발송해주세요/);
    assert.match(nhnEmailFailureMessage(http(500, "Internal Server Error")), /NHN 서버에 일시적인 문제/);
    for (const code of [401, 403, 404, 429, 500]) assert.doesNotMatch(nhnEmailFailureMessage(http(code, "Unauthorized")), /Unauthorized|Internal|HTTP \d{3}:/);
    assert.equal(
        nhnEmailFailureMessage({ header: { isSuccessful: false, resultCode: -2010, resultMessage: "sender address not registered" } }),
        "NHN이 발송 요청을 받지 않았습니다 (코드 -2010: sender address not registered). 발신 주소가 NHN에 등록됐는지와 키 설정을 확인해주세요.",
    );
    // 헤더는 성공이어도 수신자를 거절한 경우 — 그 수신자의 코드로 안내
    assert.match(
        nhnEmailFailureMessage({ header: { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" }, data: { requestId: "r", results: [{ resultCode: -3001, resultMessage: "invalid receiver" }] } }, "테스트 발송"),
        /^NHN이 테스트 발송 요청을 받지 않았습니다 \(코드 -3001/,
    );
    assert.equal(nhnEmailFailureMessage({ header: { isSuccessful: false, resultCode: EMAIL_SEND_BLOCKED, resultMessage: "이 조직의 수신거부 목록에 등록된 주소가 있어 메일을 보내지 않았습니다." } }), "이 조직의 수신거부 목록에 등록된 주소가 있어 메일을 보내지 않았습니다.");
});
