import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCustomerDraftText } from "./draft-text";

test("과거 화면에서 보류한 CTA는 비어 있는 새 문의의 수동 전송 초안으로 복원", () => {
    assert.deepEqual(mergeCustomerDraftText("", "", "가상 사이트 신청 내용"), {
        text: "가상 사이트 신청 내용",
        suggestion: "",
    });
});

test("보류 CTA를 열어도 기존 새 문의 문장을 덮어쓰지 않고 선택지로 보존", () => {
    assert.deepEqual(mergeCustomerDraftText("직접 작성한 질문", "이전 제안", "가상 사이트 신청 내용"), {
        text: "직접 작성한 질문",
        suggestion: "가상 사이트 신청 내용",
    });
    assert.deepEqual(mergeCustomerDraftText("같은 문구", "", "같은 문구"), {
        text: "같은 문구",
        suggestion: "",
    });
});
