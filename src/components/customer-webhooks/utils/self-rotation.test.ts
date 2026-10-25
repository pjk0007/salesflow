import { test } from "node:test";
import assert from "node:assert/strict";
import { draftBaseVersion, nextSelfRotation } from "./self-rotation";

test("내가 재발급한 직후에는 초안 기준 버전이 재발급 응답 버전이 되어 '다른 변경' 경고가 뜨지 않는다", () => {
    const rotation = nextSelfRotation(null, "w1", 3, 4);
    assert.equal(draftBaseVersion(3, rotation), 4);
});

test("연속 재발급도 처음 버전에서 마지막 버전으로 이어진다", () => {
    const first = nextSelfRotation(null, "w1", 3, 4);
    const second = nextSelfRotation(first, "w1", 4, 5);
    assert.deepEqual(second, { id: "w1", from: 3, to: 5 });
    assert.equal(draftBaseVersion(3, second), 5);
});

test("다른 사람이 먼저 바꾼 뒤 재발급했다면 초안 버전을 그대로 둬 경고가 남는다", () => {
    const rotation = nextSelfRotation(null, "w1", 5, 6);
    assert.equal(draftBaseVersion(3, rotation), 3);
    assert.equal(draftBaseVersion(3, undefined), 3);
});

test("다른 웹훅의 재발급 기록은 이어 쓰지 않는다", () => {
    const first = nextSelfRotation(null, "w1", 3, 4);
    assert.deepEqual(nextSelfRotation(first, "w2", 4, 5), { id: "w2", from: 4, to: 5 });
});
