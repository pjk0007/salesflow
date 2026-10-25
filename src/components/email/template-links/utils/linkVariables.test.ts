// UX-163 — 연결 화면의 변수 목록은 첫 메일과 후속 단계 템플릿을 모두 보고, 매핑 안 된 변수를 저장 전에 알린다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkTemplateTexts, linkVariableStatus } from "./linkVariables";
import { unmappedEmailVariables } from "@/lib/email-utils";

const templates = [
    { id: 1, subject: "##이름##님 안녕하세요", htmlBody: "<p>##회사명##</p>" },
    { id: 2, subject: "다시 연락드립니다", htmlBody: "##이름##님, ##담당자##입니다" },
    { id: 3, subject: "변수 없음", htmlBody: "<p>본문</p>" },
];

test("후속 단계 템플릿의 변수까지 목록에 들어간다", () => {
    const texts = linkTemplateTexts(templates, 1, [{ delayDays: 3, onNotClicked: { templateId: 2 } }]);
    assert.deepEqual(linkVariableStatus(texts, {}).all, ["##이름##", "##회사명##", "##담당자##"]);
});

test("모두 매핑하면 누락 없음, 일부만 매핑하면 누락 변수가 남는다", () => {
    const texts = linkTemplateTexts(templates, 1, [{ delayDays: 3, onNotClicked: { templateId: 2 } }]);
    const full = { "##이름##": "name", "##회사명##": "company", "##담당자##": "owner" };
    assert.deepEqual(linkVariableStatus(texts, full), { all: ["##이름##", "##회사명##", "##담당자##"], unmapped: [], mappedCount: 3 });
    const partial = linkVariableStatus(texts, { "##이름##": "name", "##회사명##": "" });
    assert.deepEqual(partial.unmapped, ["##회사명##", "##담당자##"]);
    assert.equal(partial.mappedCount, 1);
});

test("변수 없는 템플릿·후속 없음은 영향 없다", () => {
    assert.deepEqual(linkVariableStatus(linkTemplateTexts(templates, 3, null), {}), { all: [], unmapped: [], mappedCount: 0 });
    assert.deepEqual(linkTemplateTexts(templates, null, null), []);
});

test("발송 경로 판정: 매핑에 없는 변수만 누락으로 본다 (매핑 값 빈 문자열 = 선택 안 함)", () => {
    assert.deepEqual(unmappedEmailVariables(["##이름##", "<p>##회사명##</p>"], { "##이름##": "name" }), ["##회사명##"]);
    assert.deepEqual(unmappedEmailVariables(["##이름##"], { "##이름##": "" }), ["##이름##"]);
    assert.deepEqual(unmappedEmailVariables(["변수 없음", null, undefined], null), []);
});
