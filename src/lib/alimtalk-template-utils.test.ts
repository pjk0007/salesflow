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
test("UX-270: 국가번호 형식 휴대폰은 국내 번호로, 국내 형식은 그대로", async () => {
    const { normalizePhoneNumber } = await import("./alimtalk-template-utils");
    for (const phone of ["+82 10-1234-5678", "+821012345678", "82 010 1234 5678", "+82-10-1234-5678"]) assert.equal(normalizePhoneNumber(phone), "01012345678");
    assert.equal(normalizePhoneNumber("+82 11 123 4567"), "0111234567");
    for (const [phone, expected] of [["010-1234-5678", "01012345678"], ["01012345678", "01012345678"], ["02-1234-5678", "0212345678"], ["+82 2 1234 5678", "82212345678"]]) assert.equal(normalizePhoneNumber(phone), expected);
});
test("UX-257: 검수 요청 본문은 유형별로 보이는 입력란만 싣는다(16개 조합)", async () => {
    const { buildTemplateSubmitPayload } = await import("./alimtalk-template-utils");
    const form = {
        templateName: "가상", templateContent: "본문", templateMessageType: "BA", templateEmphasizeType: "NONE",
        templateExtra: "부가", templateTitle: "타이틀", templateSubtitle: "서브", templateHeader: "헤더",
        securityFlag: false, categoryCode: "", buttons: [], quickReplies: [], interactionType: "buttons" as const,
        templateImageName: "a.png", templateImageUrl: "https://example.test/a.png",
        templateItem: { list: [{ title: "항목", description: "값" }] },
        templateItemHighlight: { title: "하이라이트", description: "설명" },
        templateRepresentLink: null,
    };
    for (const messageType of ["BA", "EX", "AD", "MI"]) for (const emphasize of ["NONE", "TEXT", "IMAGE", "ITEM_LIST"]) {
        const payload = buildTemplateSubmitPayload({ ...form, templateMessageType: messageType, templateEmphasizeType: emphasize }) as Record<string, unknown>;
        const label = `${messageType}×${emphasize}`;
        assert.equal("templateExtra" in payload, messageType === "EX" || messageType === "MI", label);
        assert.equal("templateTitle" in payload, emphasize === "TEXT", label);
        assert.equal("templateSubtitle" in payload, emphasize === "TEXT", label);
        assert.equal("templateImageUrl" in payload, emphasize === "IMAGE" || emphasize === "ITEM_LIST", label);
        assert.equal("templateItem" in payload, emphasize === "ITEM_LIST", label);
        assert.equal("templateItemHighlight" in payload, emphasize === "ITEM_LIST", label);
        assert.equal(payload.templateHeader, "헤더", label);
        assert.equal(payload.templateContent, "본문", label);
    }
});
test("UX-187: 30·75·120분, 일+시간 합산, legacy 단일 객체·배열을 열고 저장해도 총 지연 보존, 단위만 실제 변경 시 바뀜", async () => {
    const { loadAlimtalkFollowupSteps, saveAlimtalkFollowupSteps } = await import("./alimtalk-template-utils");
    const minutes = (s: { delayDays?: number; delayHours?: number; delayMinutes?: number }) => (s.delayDays ?? 0) * 1440 + (s.delayHours ?? 0) * 60 + (s.delayMinutes ?? 0);
    const cases = [
        { templateCode: "A", delayMinutes: 30 }, { templateCode: "A", delayMinutes: 75 }, { templateCode: "A", delayMinutes: 120 },
        { templateCode: "A", delayDays: 1, delayHours: 6 }, { templateCode: "A", delayHours: 3 },
    ];
    // 배열 전체 왕복
    const restored = saveAlimtalkFollowupSteps(loadAlimtalkFollowupSteps(cases));
    assert.deepEqual(restored.map(minutes), cases.map(minutes));
    // 단일 객체(legacy)
    assert.equal(minutes(saveAlimtalkFollowupSteps(loadAlimtalkFollowupSteps({ templateCode: "A", delayMinutes: 75 }))[0]), 75);
    // 75분은 시간 단위로 반올림하지 않는다(이전: 1시간으로 바뀜)
    assert.deepEqual(loadAlimtalkFollowupSteps({ templateCode: "A", delayMinutes: 75 })[0].delayUnit, "minutes");
    // 사용자가 값을 바꾼 경우에만 바뀐다
    const [step] = loadAlimtalkFollowupSteps({ templateCode: "A", delayMinutes: 120 });
    assert.equal(minutes(saveAlimtalkFollowupSteps([{ ...step, delayValue: 3 }])[0]), 180);
});
