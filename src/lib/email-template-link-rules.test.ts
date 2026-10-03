import { test } from "node:test";
import assert from "node:assert";
import { collectLinkTemplateIds } from "./email-template-link-rules";

// 템플릿 발송 규칙이 가리키는 템플릿 id — 저장 전 조직 소유 확인에 쓴다 (리뷰 SEC-1)

test("첫 메일 템플릿과 후속 단계 템플릿을 중복 없이 모은다", () => {
    const r = collectLinkTemplateIds({
        emailTemplateId: 3,
        followupConfig: [
            { delayDays: 3, onClicked: { templateId: 5 }, onNotClicked: { templateId: 3 } },
            { delayDays: 7, onNotClicked: { templateId: 9 } },
        ],
    });
    assert.deepEqual(r, { ok: true, ids: [3, 5, 9] });
});

test("후속 설정이 단계 하나(옛 모양)여도 읽는다", () => {
    const r = collectLinkTemplateIds({ followupConfig: { delayDays: 1, onClicked: { templateId: 4 } } });
    assert.deepEqual(r, { ok: true, ids: [4] });
});

test("후속이 없거나 분기가 비어 있으면 모을 것이 없다 — 비운 분기는 보내지 않는다는 뜻이다", () => {
    assert.deepEqual(collectLinkTemplateIds({}), { ok: true, ids: [] });
    assert.deepEqual(collectLinkTemplateIds({ followupConfig: null }), { ok: true, ids: [] });
    assert.deepEqual(
        collectLinkTemplateIds({ followupConfig: [{ delayDays: 1 }, { delayDays: 2, onClicked: { templateId: null } }] }),
        { ok: true, ids: [] },
    );
});

test("숫자 문자열 id는 숫자로 읽는다", () => {
    assert.deepEqual(collectLinkTemplateIds({ emailTemplateId: "12" }), { ok: true, ids: [12] });
});

test("잘못된 id는 거절한다 — 소유 확인을 건너뛰고 저장되지 않게", () => {
    for (const bad of [0, -1, 1.5, "abc", true, {}, []]) {
        assert.equal(collectLinkTemplateIds({ emailTemplateId: bad }).ok, false, `값: ${JSON.stringify(bad)}`);
    }
    assert.equal(
        collectLinkTemplateIds({ followupConfig: [{ delayDays: 1, onClicked: { templateId: "x" } }] }).ok,
        false,
    );
});

test("후속 설정 모양이 이상하면 거절한다", () => {
    assert.equal(collectLinkTemplateIds({ followupConfig: ["단계"] }).ok, false);
    assert.equal(collectLinkTemplateIds({ followupConfig: [{ delayDays: 1, onClicked: 5 }] }).ok, false);
});
