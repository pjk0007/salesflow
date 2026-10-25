import assert from "node:assert/strict";
import test from "node:test";
import { sendResultHeading } from "./send-result";

test("전부 제외·실패면 경고와 '접수된 발송이 없습니다'", () => {
    assert.deepEqual(sendResultHeading({ successCount: 0, failCount: 0, unknownCount: 0 }), { tone: "warning", title: "접수된 발송이 없습니다" });
    assert.deepEqual(sendResultHeading({ successCount: 0, failCount: 3 }), { tone: "warning", title: "접수된 발송이 없습니다" });
});

test("응답 끊김으로 확인 필요만 있으면 경고와 확인 안내", () => {
    assert.deepEqual(sendResultHeading({ successCount: 0, failCount: 0, unknownCount: 4 }), { tone: "warning", title: "접수 여부를 확인해야 합니다" });
});

test("일부 실패·확인 필요가 섞이면 경고, 모두 접수면 초록 체크", () => {
    assert.equal(sendResultHeading({ successCount: 1, failCount: 1 }).tone, "warning");
    assert.equal(sendResultHeading({ successCount: 1, failCount: 0, unknownCount: 1 }).tone, "warning");
    assert.deepEqual(sendResultHeading({ successCount: 1, failCount: 0, unknownCount: 0 }), { tone: "success", title: "발송 요청 결과" });
});
