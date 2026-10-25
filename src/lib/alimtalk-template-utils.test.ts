import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTemplateParameterKeys, loadAlimtalkFollowupSteps, saveAlimtalkFollowupSteps } from "./alimtalk-template-utils";
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
test("UX-178: 테스트 발송 입력 키 — 본문 밖(버튼·퀵리플라이·강조·헤더·아이템) 변수도 포함, 중복 제거", () => {
    assert.deepEqual(extractTemplateParameterKeys({ templateContent: "안녕하세요 #{이름}님 #{이름}" }), ["이름"]);
    const keys = extractTemplateParameterKeys({
        templateContent: "#{이름}님",
        templateHeader: "#{헤더}",
        templateTitle: "#{강조}",
        templateItem: { list: [{ title: "#{항목}", description: "#{금액}" }] },
        buttons: [{ name: "보기", linkMo: "https://example.test/#{주문번호}" }],
        quickReplies: [{ name: "#{답장}" }],
    });
    assert.deepEqual(keys.sort(), ["강조", "금액", "답장", "이름", "주문번호", "항목", "헤더"].sort());
    assert.deepEqual(extractTemplateParameterKeys({ templateContent: "변수 없음" }), []);
    assert.deepEqual(extractTemplateParameterKeys(null), []);
});
