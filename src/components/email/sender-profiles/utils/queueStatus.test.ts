import { test } from "node:test";
import assert from "node:assert";
import { kstToDate } from "@/lib/kst";
import type { SendQueueRuleStats } from "../types";
import { etaDayLabel, formatBacklogDays, queueBadges, queueSummary, warnedRuleRows } from "./queueStatus";

// 2026-10-02 금요일. 10-07 수요일
const NOW = kstToDate("2026-10-02", 10);

function stats(over: Partial<SendQueueRuleStats> = {}): SendQueueRuleStats {
    return {
        linkId: 1,
        partitionId: 10,
        pending: { total: 12, inbound: 2, bulk: 10 },
        oldestScheduledAt: "2026-10-01T00:00:00.000Z",
        capacity: { unlimited: false, today: 4, todayRemaining: 1, schedule: [] },
        etaDate: "2026-10-07",
        backlogDays: 2.5,
        warning: false,
        ...over,
    };
}

const texts = (s: SendQueueRuleStats | undefined) => queueBadges(s, NOW).map((b) => b.text);

test("대기가 없거나 통계가 없으면 배지를 붙이지 않는다", () => {
    assert.deepEqual(texts(undefined), []);
    assert.deepEqual(texts(stats({ pending: { total: 0, inbound: 0, bulk: 0 }, etaDate: null })), []);
});

test("규칙 카드: 대기 통수와 다 나가는 날", () => {
    assert.deepEqual(texts(stats()), ["대기 12통 · 10/7(수)까지 다 나감"]);
    assert.deepEqual(texts(stats({ etaDate: "2026-10-02" })), ["대기 12통 · 오늘 다 나감"]);
    assert.deepEqual(texts(stats({ etaDate: "2026-10-03" })), ["대기 12통 · 내일까지 다 나감"]);
    assert.deepEqual(texts(stats({ etaDate: null, backlogDays: null })), ["대기 12통 · 2주 안에 다 못 나감"]);
});

test("규칙 카드 설명에 문의·대량 몫을 적는다", () => {
    assert.match(queueBadges(stats(), NOW)[0].title, /^문의 2통 · 대량 10통/);
});

// Q6 — 대기 ÷ 하루 용량 > 3 → 경고, 한도 없는 묶음은 경고 없음 (판정은 서버, 화면은 warning을 그대로 보인다)
test("3일치를 넘으면 빨간 '대기 3일치 넘음'을 하나 더 붙인다", () => {
    const b = queueBadges(stats({ warning: true, backlogDays: 4.24, etaDate: "2026-10-08" }), NOW);
    assert.deepEqual(b.map((x) => [x.text, x.tone]), [
        ["대기 12통 · 10/8(목)까지 다 나감", "info"],
        ["대기 3일치 넘음", "warning"],
    ]);
    assert.match(b[1].title, /3일치를 넘었습니다\(4\.2일치\)/);
});

test("보낼 수 있는 날이 없어 경고한 규칙은 이유를 따로 적는다 (일치 수를 지어내지 않는다)", () => {
    const s = stats({ warning: true, backlogDays: null, etaDate: null });
    const b = queueBadges(s, NOW);
    assert.deepEqual(b.map((x) => x.text), ["대기 12통 · 2주 안에 다 못 나감", "대기 3일치 넘음"]);
    assert.match(b[1].title, /보낼 수 있는 날이 없어/);
    assert.doesNotMatch(b[1].title, /일치\)/);
    assert.deepEqual(warnedRuleRows([s], [], NOW)[0].backlog, null);
});

test("한도 없는 묶음: 대기 통수만, 다 나가는 날·경고 없음", () => {
    const s = stats({ capacity: { unlimited: true, today: null, todayRemaining: null, schedule: [] }, etaDate: null, backlogDays: null });
    assert.deepEqual(texts(s), ["대기 12통"]);
    assert.equal(queueSummary(s, NOW).eta, "한도 없음");
    assert.equal(queueSummary(s, NOW).warning, null);
});

test("요약 칸: 대기·문의/대량·예상 소진·경고 문장", () => {
    assert.deepEqual(queueSummary(undefined, NOW), { pending: "없음", breakdown: null, eta: null, warning: null });
    const s = queueSummary(stats({ warning: true, backlogDays: 3.42 }), NOW);
    assert.equal(s.pending, "12통");
    assert.equal(s.breakdown, "문의 2통 · 대량 10통");
    assert.equal(s.eta, "10/7(수)");
    assert.match(s.warning ?? "", /발신 주소를 늘리거나 하루 한도를 올리세요/);
    assert.equal(queueSummary(stats({ etaDate: null }), NOW).eta, "2주 넘게");
});

test("예상 소진일 글: 오늘·내일·M/D(요일), 지난 날은 오늘", () => {
    assert.deepEqual(
        ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"].map((d) => etaDayLabel(d, NOW)),
        ["오늘", "오늘", "내일", "10/5(월)"]
    );
});

test("밀린 일수 글: 10일 아래는 소수 한 자리, 그 위는 반올림", () => {
    assert.deepEqual([3.42, 3, 3.05, 12.7].map(formatBacklogDays), ["3.4", "3", "3.1", "13"]);
});

test("대시보드 경고 목록: 경고 규칙만, 밀린 일수가 많은 순, 이름이 없으면 제품명·번호", () => {
    const rules = [
        stats({ linkId: 1, warning: true, backlogDays: 3.5 }),
        stats({ linkId: 2, warning: false, backlogDays: 1 }),
        stats({ linkId: 3, warning: true, backlogDays: 6, etaDate: null, partitionId: 11 }),
        stats({ linkId: 4, warning: true, backlogDays: 4 }),
    ];
    const links = [
        { id: 1, name: "제휴 문의", productName: "A" },
        { id: 3, name: null, productName: "매치스플랜" },
    ];
    assert.deepEqual(warnedRuleRows(rules, links, NOW), [
        { linkId: 3, partitionId: 11, name: "매치스플랜", pending: 12, backlog: "6일치", eta: "2주 넘게" },
        { linkId: 4, partitionId: 10, name: "AI 규칙 #4", pending: 12, backlog: "4일치", eta: "10/7(수)까지" },
        { linkId: 1, partitionId: 10, name: "제휴 문의", pending: 12, backlog: "3.5일치", eta: "10/7(수)까지" },
    ]);
});
