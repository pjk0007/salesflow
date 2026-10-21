import test from "node:test";
import assert from "node:assert/strict";
import { emptyCounts } from "./metrics";
import { emailSummary, triggerSummary, templateSummary, mergeHomeTrends } from "./home-map";

const counts = { ...emptyCounts(), total: 4, sent: 3, failed: 1, clicked: 1, opened: 2, openBase: 3 };
test("B26: 홈 summary·trigger 응답 키와 기존 반올림을 보존", () => {
    assert.deepEqual(emailSummary(counts), { total: 4, sent: 3, failed: 1, pending: 0, clicked: 1, clickRate: 33.3, opened: 2, openBase: 3, openRate: 66.7 });
    const trigger = triggerSummary("", counts);
    assert.equal(trigger.triggerType, "unknown");
    assert.equal(trigger.successRate, 75);
    assert.equal(emailSummary(emptyCounts()).clickRate, 0);
    assert.equal("pending" in trigger, false);
});
test("B26: 홈 규칙은 manual을 빼고 AI 이름·삭제·성공률을 보존", () => {
    assert.equal(templateSummary("manual", "수동", counts), null);
    assert.equal(templateSummary("ai", "규칙명", counts)?.name, "AI: 규칙명");
    assert.equal(templateSummary("ai", "(삭제됨)", counts)?.name, "(삭제됨)");
    assert.equal(templateSummary("template", "규칙명", { ...counts, total: 3, sent: 2 })?.successRate, 67);
});
test("B26: 날짜별 이메일과 알림톡을 같은 응답 모양으로 합친다", () => {
    assert.deepEqual(mergeHomeTrends([{ date: "2026-10-21", ...counts }], [{ date: "2026-10-20", sent: 2, failed: 1 }]), [
        { date: "2026-10-20", alimtalkSent: 2, alimtalkFailed: 1, emailSent: 0, emailFailed: 0, emailClicked: 0, emailOpened: 0 },
        { date: "2026-10-21", alimtalkSent: 0, alimtalkFailed: 0, emailSent: 3, emailFailed: 1, emailClicked: 1, emailOpened: 2 },
    ]);
});
