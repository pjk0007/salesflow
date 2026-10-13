import test from "node:test";
import assert from "node:assert/strict";
import { clickCellView } from "./clickCell";
import type { ClickCellSource, ClickCellView } from "../types";

type BadgeView = Extract<ClickCellView, { kind: "badge" }>;
const cases: { name: string; source: ClickCellSource; expected: ClickCellView }[] = [
    { name: "알림톡", source: { channel: "alimtalk", status: "sent", clickCount: 3 }, expected: { kind: "empty" } },
    { name: "실패", source: { status: "failed", clickCount: 2, botClickCount: 1 }, expected: { kind: "empty" } },
    { name: "대기", source: { channel: "email", status: "pending" }, expected: { kind: "empty" } },
    { name: "신호 누락", source: { status: "sent" }, expected: { kind: "dash" } },
    { name: "클릭 없음", source: { status: "sent", clickCount: 0, botClickCount: 0, hasSiteAction: false }, expected: { kind: "dash" } },
    { name: "클릭 없이 사이트 행동만", source: { status: "sent", clickCount: 0, botClickCount: 0, hasSiteAction: true }, expected: { kind: "dash" } },
];
const badgeCases: { name: string; source: ClickCellSource; expected: BadgeView }[] = [
    {
        name: "사람 클릭",
        source: { status: "sent", clickCount: 2, botClickCount: 0, hasSiteAction: false },
        expected: { kind: "badge", tone: "human", text: "2회", botIcon: false, actionIcon: false, title: "사람 클릭 2회" },
    },
    {
        name: "사람과 봇 혼합",
        source: { status: "sent", clickCount: 2, botClickCount: 3, hasSiteAction: false },
        expected: { kind: "badge", tone: "human", text: "2회", botIcon: false, actionIcon: false, title: "사람 클릭 2회 · 봇 클릭 3회 · 전체 5회" },
    },
    {
        name: "사람 클릭과 사이트 행동",
        source: { channel: "email", status: "sent", clickCount: 1, botClickCount: 0, hasSiteAction: true },
        expected: { kind: "badge", tone: "humanAction", text: "1회", botIcon: false, actionIcon: true, title: "사람 클릭 1회 · 사이트 행동 있음" },
    },
    {
        name: "혼합 클릭과 사이트 행동",
        source: { status: "sent", clickCount: 2, botClickCount: 3, hasSiteAction: true },
        expected: { kind: "badge", tone: "humanAction", text: "2회", botIcon: false, actionIcon: true, title: "사람 클릭 2회 · 봇 클릭 3회 · 전체 5회 · 사이트 행동 있음" },
    },
    {
        name: "봇 클릭만",
        source: { status: "sent", clickCount: 0, botClickCount: 4, hasSiteAction: false },
        expected: { kind: "badge", tone: "bot", text: "", botIcon: true, actionIcon: false, title: "봇 클릭 4회 · 사람 클릭 없음" },
    },
    {
        name: "봇 클릭과 사이트 행동",
        source: { status: "sent", clickCount: 0, botClickCount: 4, hasSiteAction: true },
        expected: { kind: "badge", tone: "botAction", text: "", botIcon: true, actionIcon: true, title: "봇 클릭 4회 · 사람 클릭 없음 · 사이트 행동 있음" },
    },
];
for (const { name, source, expected } of [...cases, ...badgeCases]) {
    test(`B26: ${name}`, () => assert.deepEqual(clickCellView(source), expected));
}
test("B26: 모든 뱃지의 보이는 글자는 숫자+회 또는 빈 문자열", () => {
    for (const { source } of badgeCases) {
        const view = clickCellView(source);
        assert.equal(view.kind, "badge");
        if (view.kind === "badge") assert.match(view.text, /^(\d+회)?$/);
    }
});
