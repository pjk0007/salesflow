import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAlimtalkFollowupSteps, saveAlimtalkFollowupSteps } from "./alimtalk-template-utils";
test("UX-176·187: 기존·분·합산 일정과 단계 발신 프로필은 열고 저장해도 보존", () => {
    for (const original of [
        { templateCode: "A", delayDays: 2 }, { templateCode: "A", delayMinutes: 30, senderKey: "channel-b" },
        { templateCode: "A", delayDays: 1, delayHours: 3, delayMinutes: 15, senderKey: "channel-b", variableMappings: { "#{이름}": "name" } },
    ]) {
        const restored = saveAlimtalkFollowupSteps(loadAlimtalkFollowupSteps(original))[0];
        const minutes = (s: { delayDays?: number; delayHours?: number; delayMinutes?: number }) => (s.delayDays ?? 0) * 1440 + (s.delayHours ?? 0) * 60 + (s.delayMinutes ?? 0);
        assert.equal(minutes(restored), minutes(original));
        assert.equal(restored.senderKey, original.senderKey);
        assert.deepEqual(restored.variableMappings, original.variableMappings);
    }
    assert.deepEqual(loadAlimtalkFollowupSteps(null), []);
});
