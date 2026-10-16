import { test } from "node:test";
import assert from "node:assert";
import { splitKnownSenderIds, formSenderIds } from "./senderPool";

// 규칙 복제 때 지워진 발신 프로필을 빼고 보낸다 (리뷰 SEC-4 — 지워진 id가 남은 규칙의 복제가 늘 400으로 실패했다)

test("지워진 프로필만 빼고 순서는 그대로 둔다", () => {
    assert.deepEqual(splitKnownSenderIds([5, 6, 7], [7, 5]), { kept: [5, 7], dropped: [6] });
});

test("다 지워졌으면 빈 묶음 — 기본 발신 프로필로 보낸다", () => {
    assert.deepEqual(splitKnownSenderIds([5], []), { kept: [], dropped: [5] });
});

test("빈 묶음은 빈 묶음이다", () => {
    assert.deepEqual(splitKnownSenderIds([], [1, 2]), { kept: [], dropped: [] });
});


test("formSenderIds: unedited uses saved pool or legacy single id (B22)", () => {
    assert.deepEqual(formSenderIds(null, { senderProfileId: 8, senderProfileIds: [8, 7] }), [8, 7]);
    assert.deepEqual(formSenderIds(null, { senderProfileId: 7, senderProfileIds: null }), [7]);
});

test("formSenderIds: edited selection including empty survives saved refresh (B22)", () => {
    for (const edited of [[7], []]) {
        assert.deepEqual(formSenderIds(edited, { senderProfileId: 8, senderProfileIds: [8] }), edited);
        assert.deepEqual(formSenderIds(edited, { senderProfileId: 9, senderProfileIds: [9] }), edited);
    }
});

test("formSenderIds: no saved pool starts empty (B21)", () => {
    for (const saved of [undefined, null, { senderProfileId: null, senderProfileIds: null }]) {
        assert.deepEqual(formSenderIds(null, saved), []);
    }
});
