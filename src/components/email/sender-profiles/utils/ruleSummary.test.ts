import { test } from "node:test";
import assert from "node:assert";
import { followupBadgeLabel, followupSteps, senderPoolSummary } from "./ruleSummary";

// 규칙 목록 카드에 '후속 일'로 보이던 것 — followupConfig가 배열인데 객체로 읽었다

test("후속: 배열 한 단계면 '후속 3일'", () => {
    assert.equal(followupBadgeLabel([{ delayDays: 3, onClicked: { prompt: "a" } }]), "후속 3일");
});

test("후속: 예전 객체 모양도 읽는다", () => {
    assert.equal(followupBadgeLabel({ delayDays: 5 }), "후속 5일");
});

test("후속: 여러 단계면 단계 수와 날짜들", () => {
    assert.equal(followupBadgeLabel([{ delayDays: 3 }, { delayDays: 6 }]), "후속 2단계(3·6일)");
    assert.equal(followupBadgeLabel([{ delayDays: 3 }, {}]), "후속 2단계");
});

test("후속: 없거나 빈 배열이면 배지를 붙이지 않는다", () => {
    assert.equal(followupBadgeLabel(null), null);
    assert.equal(followupBadgeLabel([]), null);
    assert.deepEqual(followupSteps("x"), []);
});

const PROFILES = [
    { id: 1, name: "기본 주소", isDefault: true },
    { id: 2, name: "웜업 주소1", isDefault: false },
    { id: 3, name: "웜업 주소2", isDefault: false },
];

test("발신 묶음 요약: 순서대로 이름", () => {
    assert.deepEqual(senderPoolSummary([3, 2, 1], PROFILES, true), {
        kind: "pool",
        items: [
            { id: 3, label: "웜업 주소2", missing: false },
            { id: 2, label: "웜업 주소1", missing: false },
            { id: 1, label: "기본 주소", missing: false },
        ],
    });
});

test("발신 묶음 요약: 비어 있으면 기본 발신 프로필", () => {
    assert.deepEqual(senderPoolSummary([], PROFILES, true), { kind: "default", label: "기본 (기본 주소)" });
    assert.deepEqual(senderPoolSummary([], [], false), { kind: "default", label: "기본 발신 프로필" });
});

test("발신 묶음 요약: 지워진 id는 목록을 읽은 뒤에만 삭제됨으로 본다", () => {
    assert.deepEqual(senderPoolSummary([9], PROFILES, true), {
        kind: "pool",
        items: [{ id: 9, label: "삭제된 프로필 (#9)", missing: true }],
    });
    assert.deepEqual(senderPoolSummary([9], [], false), { kind: "pool", items: [{ id: 9, label: "프로필 #9", missing: false }] });
});
