import assert from "node:assert/strict";
import test from "node:test";
import { EsignApiError } from "../api/client";
import { SIGNER_UNAVAILABLE_MESSAGE, signerErrorMessage } from "./presentation";

test("서명자 화면은 서버 설정 문구 대신 고객용 안내를 보여 준다", () => {
    const configuration = new EsignApiError("전자서명 전용 암호화 키가 필요합니다. 전자서명 메타데이터 DB 연결이 필요합니다.", 503, "configuration");
    assert.equal(signerErrorMessage(configuration, "대체"), SIGNER_UNAVAILABLE_MESSAGE);
    assert.doesNotMatch(SIGNER_UNAVAILABLE_MESSAGE, /암호화 키|DB|저장소/);
});

test("고객용으로 작성된 서버 문구와 일반 오류는 그대로, 문구가 없으면 대체 문구", () => {
    const expired = new EsignApiError("만료된 서명 요청입니다.", 410, "expired");
    assert.equal(signerErrorMessage(expired, "대체"), "만료된 서명 요청입니다.");
    assert.equal(signerErrorMessage(new Error(""), "대체"), "대체");
    assert.equal(signerErrorMessage("문자열", "대체"), "대체");
    assert.equal(signerErrorMessage(null, "대체"), "대체");
});
