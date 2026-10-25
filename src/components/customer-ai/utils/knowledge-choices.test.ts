import { test } from "node:test";
import assert from "node:assert/strict";
import { supportKnowledgeChoices } from "./knowledge-choices";

const options = [
    { id: 3, state: "blocked" },
    { id: 4, state: "approved" },
    { id: 5, state: "draft" },
];

test("승인 지식 선택지에는 승인된 지식만 나온다 — 차단·초안은 빠진다 (UX-238)", () => {
    assert.deepEqual(supportKnowledgeChoices(options, null).map((k) => k.id), [4]);
});

test("이미 설정에 연결된 차단 지식은 남겨 차단 상태를 보여준다", () => {
    assert.deepEqual(supportKnowledgeChoices(options, 3).map((k) => k.id), [3, 4]);
});

test("이미 설정에 연결된 초안 지식도 남겨 현재 연결을 보여준다", () => {
    assert.deepEqual(supportKnowledgeChoices(options, 5).map((k) => k.id), [4, 5]);
});
