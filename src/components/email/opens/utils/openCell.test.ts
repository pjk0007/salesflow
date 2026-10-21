import test from "node:test";
import assert from "node:assert/strict";
import type { OpenCellSource, OpenCellView } from "../types";
import { openCellView } from "./openCell";

const badge = (tone: "human" | "machine" | "byClick", text: string, title: string): OpenCellView => ({
    kind: "badge", tone, text, title, machineIcon: tone === "machine", clickIcon: tone === "byClick",
});
const cases: [Partial<OpenCellSource>, OpenCellView][] = [
    [{ channel: "alimtalk", openTracked: true, openCount: 3 }, { kind: "empty" }],
    [{ status: "failed", openTracked: true, openCount: 1 }, { kind: "empty" }],
    [{ channel: "email", status: "pending", openTracked: true }, { kind: "empty" }],
    [{ openTracked: false, openCount: 2, clickCount: 1 }, { kind: "empty" }],
    [{ openCount: 1 }, { kind: "empty" }],
    [{ openTracked: true }, { kind: "dash" }],
    [{ openTracked: true, openCount: 0, machineOpenCount: 0, clickCount: 0 }, { kind: "dash" }],
    [{ openTracked: true, openCount: 2 }, badge("human", "2회", "사람 오픈 2회")],
    [{ openTracked: true, openCount: 1, machineOpenCount: 3 }, badge("human", "1회", "사람 오픈 1회 · 기계 오픈 3회")],
    [{ channel: "email", openTracked: true, openCount: 1, clickCount: 2 }, badge("human", "1회", "사람 오픈 1회")],
    [{ openTracked: true, machineOpenCount: 4 }, badge("machine", "", "기계 오픈 4회 · 사람 오픈 없음")],
    [{ openTracked: true, clickCount: 2 }, badge("byClick", "", "사람 클릭 2회로 오픈 셈")],
    [{ openTracked: true, clickCount: 1, machineOpenCount: 2 }, badge("byClick", "", "사람 클릭 1회로 오픈 셈 · 기계 오픈 2회")],
];
for (const [index, [input, expected]] of cases.entries()) {
    test(`B28: 오픈 칸 계약 ${index + 1}`, () => {
        const actual = openCellView({ status: "sent", ...input });
        assert.deepEqual(actual, expected);
        if (actual.kind === "badge") assert.match(actual.text, /^(\d+회)?$/);
    });
}
