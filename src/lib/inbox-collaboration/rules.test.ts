import test from "node:test";
import assert from "node:assert/strict";
import { mentionIdsInput, sameMentionIds } from "./rules";
const ids = Array.from(
    { length: 21 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);
test("멘션 없음과 한 메모 20명까지 허용", () => {
    assert.deepEqual(mentionIdsInput.parse([]), []);
    assert.equal(mentionIdsInput.parse(ids.slice(0, 20)).length, 20);
});
test("멘션 대상 중복과 21명 이상 거절", () => {
    assert.equal(mentionIdsInput.safeParse([ids[0], ids[0]]).success, false);
    assert.equal(mentionIdsInput.safeParse(ids).success, false);
});
test("이름/객체/잘못된 번호로 사람을 선택할 수 없음", () => {
    for (const raw of [["효정"], [{ id: ids[0] }], "all", [1]])
        assert.equal(mentionIdsInput.safeParse(raw).success, false);
});
test("네트워크 재시도에서 대상 순서만 바뀌면 동일하고 대상 변경은 구분", () => {
    assert.equal(sameMentionIds([ids[0], ids[1]], [ids[1], ids[0]]), true);
    assert.equal(sameMentionIds([ids[0]], [ids[1]]), false);
    assert.equal(sameMentionIds([], []), true);
});
