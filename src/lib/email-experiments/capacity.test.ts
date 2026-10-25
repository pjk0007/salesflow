// UX-159 — 실험 미리보기 용량: 프로필 0개·묶음 전부 삭제·정상 묶음에서 실제 발송과 같은 주소로 계산한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { previewCapacitySchedule } from "./capacity";

const today = "2026-10-25";
const profile = (id: number, dailyLimit: number | null, isDefault = false) => ({ id, from_email: `s${id}@example.test`, from_name: `주소${id}`, is_default: isDefault, daily_limit: dailyLimit });

test("프로필 0개(설정 발신자로 발송): 용량 제한 없음(null), 날짜는 오늘부터 채운다", () => {
    const days = previewCapacitySchedule([], [5], today);
    assert.equal(days.length, 42);
    assert.deepEqual(days[0], { date: "2026-10-25", capacity: null });
    assert.equal(days[41].date, "2026-12-05");
    assert(days.every((d) => d.date !== "" && d.capacity === null));
});

test("묶음의 주소가 모두 삭제됨: 기본 프로필로 계산한다 (0이 아니다)", () => {
    const days = previewCapacitySchedule([profile(1, 30, true), profile(2, 100)], [9, 10], today);
    assert.equal(days[0].capacity, 30);
});

test("묶음 삭제 + 기본 프로필 없음: 설정 발신자 — 제한 없음", () => {
    const days = previewCapacitySchedule([profile(2, 100)], [9], today);
    assert.equal(days[0].capacity, null);
});

test("정상 묶음: 묶음 주소들의 한도 합, 묶음 밖 주소는 넣지 않는다", () => {
    const days = previewCapacitySchedule([profile(1, 30, true), profile(2, 100), profile(3, 50)], [2, 3], today);
    assert.equal(days[0].capacity, 150);
    assert.equal(days[0].date, today);
});

test("규칙에 묶음이 없으면 모든 주소가 아니라 기본 프로필만 (실제 발송과 같음)", () => {
    const days = previewCapacitySchedule([profile(1, 30, true), profile(2, 100)], null, today);
    assert.equal(days[0].capacity, 30);
});
