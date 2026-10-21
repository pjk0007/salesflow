import test from "node:test";
import assert from "node:assert/strict";
import { previousRange } from "../tracker/date-range";
import { kstToday, presetRange, kstDayBounds, recentWindow, nightlyWindow, lateCutoff, priorityFloor, nightlyDue, backfillPhase, backfillAllowed, nextBackfillChunk, nightlyChunks, mergeDateRanges } from "./rules";
const NOW = new Date("2026-10-21T03:00:00Z");
const at = (day: string, time: string) => new Date(`${day}T${time}:00+09:00`);
test("B5: KST 자정 경계와 연말의 배타적 끝", () => {
    assert.equal(kstToday(new Date("2026-10-20T15:00:00Z")), "2026-10-21");
    assert.equal(kstToday(new Date("2026-10-20T14:59:59.999Z")), "2026-10-20");
    assert.deepEqual(kstDayBounds("2026-10-15", "2026-10-21"), { fromIso: "2026-10-15T00:00:00+09:00", toIso: "2026-10-22T00:00:00+09:00" });
    assert.equal(kstDayBounds("2026-12-31", "2026-12-31").toIso, "2027-01-01T00:00:00+09:00");
});
test("B24: 오늘 포함 프리셋과 같은 길이 직전 기간", () => {
    for (const [days, from] of [[7, "2026-10-15"], [30, "2026-09-22"], [90, "2026-07-24"]] as const)
        assert.deepEqual(presetRange(days, NOW), { from, to: "2026-10-21" });
    assert.deepEqual(previousRange("2026-09-22", "2026-10-21"), { fromYmd: "2026-08-23", toYmd: "2026-09-21" });
});
test("B7: 최근·야간·늦은 이벤트·우선 백필 경계", () => {
    assert.deepEqual(recentWindow(NOW), { from: "2026-10-14", to: "2026-10-21" });
    assert.deepEqual(nightlyWindow(NOW), { from: "2026-09-17", to: "2026-10-13" });
    assert.equal(lateCutoff(NOW), "2026-09-16");
    assert.equal(priorityFloor(NOW), "2026-08-23");
});
test("B7: 야간 재계산은 01시 이후 발송 창 밖에서 하루 한 번", () => {
    for (const [day, time, expected] of [["2026-10-21", "00:30", false], ["2026-10-21", "01:05", true], ["2026-10-21", "10:00", false], ["2026-10-21", "19:00", true], ["2026-10-24", "11:00", true]] as const)
        assert.equal(nightlyDue("2026-10-20", at(day, time)), expected);
    assert.equal(nightlyDue("2026-10-21", at("2026-10-21", "19:00")), false);
    assert.equal(nightlyDue(null, at("2026-10-21", "19:00")), true);
});
test("B9: 백필 단계와 발송 창 제한", () => {
    assert.equal(backfillPhase("2026-10-14", "2026-03-01", NOW), "priority");
    assert.equal(backfillPhase("2026-08-23", "2026-03-01", NOW), "rest");
    assert.equal(backfillPhase("2026-03-01", "2026-03-01", NOW), "done");
    assert.equal(backfillPhase("2026-10-14", null, NOW), "done");
    assert.equal(backfillAllowed("rest", at("2026-10-21", "10:00")), false);
    assert.equal(backfillAllowed("rest", at("2026-10-21", "18:00")), true);
    assert.equal(backfillAllowed("rest", at("2026-10-24", "11:00")), true);
    assert.equal(backfillAllowed("priority", at("2026-10-21", "10:00")), true);
    assert.equal(backfillAllowed("done", NOW), false);
});
test("B9: 백필 두 날짜와 야간 세 날짜 조각은 채운 경계까지", () => {
    assert.deepEqual(nextBackfillChunk("2026-10-14", "2026-10-01"), { from: "2026-10-12", to: "2026-10-13" });
    assert.deepEqual(nextBackfillChunk("2026-10-02", "2026-10-01"), { from: "2026-10-01", to: "2026-10-01" });
    assert.equal(nextBackfillChunk("2026-10-01", "2026-10-01"), null);
    const chunks = nightlyChunks(null, "2026-09-01", NOW);
    assert.deepEqual(chunks[0], { from: "2026-10-11", to: "2026-10-13" });
    assert.equal(chunks.at(-1)?.from, "2026-09-17");
    assert.equal(nightlyChunks(null, "2026-10-01", NOW).at(-1)?.from, "2026-10-01");
    assert.deepEqual(nightlyChunks("2026-10-10", "2026-10-01", NOW)[0], { from: "2026-10-08", to: "2026-10-10" });
});
test("B8: 날짜를 정렬하고 중복을 없애 연속 구간으로 합친다", () => {
    assert.deepEqual(mergeDateRanges(["2026-09-03", "2026-09-01", "2026-09-02", "2026-09-10", "2026-09-02"]), [{ from: "2026-09-01", to: "2026-09-03" }, { from: "2026-09-10", to: "2026-09-10" }]);
    assert.deepEqual(mergeDateRanges([]), []);
});
