import test from "node:test";
import assert from "node:assert/strict";
import { resolveAttribution, isExcludedSend, type SendAttrInput, type ParentAttr } from "./attribution";
const row = (id: number, overrides: Partial<SendAttrInput> = {}): SendAttrInput => ({
    id, orgId: "O", statDate: "2026-10-21", workspaceId: null, partitionId: null, triggerType: null,
    parentLogId: null, autoPersonalizedLinkId: null, templateLinkId: null, emailTemplateId: null,
    senderProfileId: null, senderDomain: "example.com", ...overrides,
});
const rows = [
    row(101, { autoPersonalizedLinkId: 7 }), row(102, { parentLogId: 101, templateLinkId: 9 }), row(103, { parentLogId: 102 }),
    row(201, { templateLinkId: 5 }), row(301, { emailTemplateId: 12 }), row(302),
    row(401, { parentLogId: 9999, templateLinkId: 4 }), row(402, { parentLogId: 88 }), row(403, { parentLogId: 89, autoPersonalizedLinkId: 6 }),
];
const parents = new Map<number, ParentAttr | "missing">([
    [9999, "missing"],
    [88, { sendLogId: 88, orgId: "O", rootLogId: 80, stepIndex: 1, campaignKind: "template", campaignId: 3 }],
    [89, { sendLogId: 89, orgId: "X", rootLogId: 80, stepIndex: 1, campaignKind: "template", campaignId: 3 }],
]);
test("B2: 후속은 자기 링크보다 부모 캠페인을 우선하고 누락·다른 조직 부모는 자기 귀속", () => {
    assert.deepEqual(resolveAttribution(rows, parents).map(r => [r.sendLogId, r.campaignKind, r.campaignId, r.rootLogId, r.stepIndex]), [
        [101, "ai", 7, 101, 0], [102, "ai", 7, 101, 1], [103, "ai", 7, 101, 2],
        [201, "template", 5, 201, 0], [301, "manual", 12, 301, 0], [302, "manual", 0, 302, 0],
        [401, "template", 4, 401, 0], [402, "template", 3, 80, 2], [403, "ai", 6, 403, 0],
    ]);
});
test("B2: 순서를 섞어도 같은 귀속이며 입력을 변경하지 않는다", () => {
    const shuffled = [...rows].reverse();
    const snapshot = structuredClone(shuffled);
    assert.deepEqual(resolveAttribution(shuffled, parents), resolveAttribution(rows, parents));
    assert.deepEqual(shuffled, snapshot);
    assert.equal(parents.size, 3);
});
test("B2: null 차원은 기본값이고 기존 차원은 보존된다", () => {
    assert.deepEqual(resolveAttribution([row(1)], new Map())[0], {
        sendLogId: 1, orgId: "O", statDate: "2026-10-21", workspaceId: 0, partitionId: 0, triggerType: "",
        campaignKind: "manual", campaignId: 0, rootLogId: 1, stepIndex: 0, senderProfileId: 0, senderDomain: "example.com",
    });
    const result = resolveAttribution([row(1, { workspaceId: 3, partitionId: 4, senderProfileId: 5, triggerType: "manual" })], new Map())[0];
    assert.deepEqual([result.workspaceId, result.partitionId, result.senderProfileId, result.triggerType], [3, 4, 5, "manual"]);
});
test("B3: 시험 접두·데모·취소만 제외하고 실패·미확정은 포함", () => {
    for (const [triggerType, status] of [["test_followup", "sent"], ["testX", "sent"], ["journey_demo", "demo"], ["manual", "demo"], ["followup", "cancelled"], ["journey_demo", "sent"]])
        assert.equal(isExcludedSend({ triggerType, status }), true);
    for (const [triggerType, status] of [[null, "sent"], ["ai_auto", "failed"], ["visit_ack", "uncertain"], ["TestX", "sent"]])
        assert.equal(isExcludedSend({ triggerType, status: status! }), false);
});
