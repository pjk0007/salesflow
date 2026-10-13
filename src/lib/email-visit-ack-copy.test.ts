import { test } from "node:test";
import assert from "node:assert/strict";
import { renderVisitAckCopy, visitAckCopyPrompt } from "./email-visit-ack-copy";
import type { JourneyCardInput } from "./customer-journey-card";

const fields = [{ key: "contactName", label: "담당자", fieldType: "text", value: "류진모" }];
const copy = { paragraphs: ["갑작스러운 메일에도 사이트를 방문해 주셔서 감사합니다.", "살펴보시면서 더 궁금하셨던 점이 있으실까요?", "편하실 때 전화나 답장 주시면 친절히 안내하겠습니다."] };

test("LLM 문장은 의미를 유지하고 실제 고객 이름으로 인사한다", () => {
    const body = renderVisitAckCopy(fields, copy);
    assert.match(body, /안녕하세요, 류진모님/);
    assert.match(body, /더 궁금하셨던 점/);
    const varied = renderVisitAckCopy(fields, { paragraphs: ["보내드린 메일을 보고 사이트에 방문해 주셔서 고맙습니다.", "추가로 설명이 필요하신 부분이 있을까요?", "전화나 회신으로 편하게 말씀해 주시면 안내해 드리겠습니다."] });
    assert.notEqual(body, varied);
    assert.match(renderVisitAckCopy([], copy), /<p>안녕하세요\.<\/p>/);
});

test("LLM 출력의 추적 정보·새 혜택·URL·HTML·잘못된 형식은 발송하지 않는다", () => {
    for (const sentence of ["가격 페이지를 클릭하셨네요", "체류 시간이 길었습니다", "무료 혜택이 있습니다", "https://evil.test", "<script>alert()</script>", "7초 동안 방문하셨습니다"]) {
        assert.throws(() => renderVisitAckCopy(fields, { paragraphs: [copy.paragraphs[0] + sentence, ...copy.paragraphs.slice(1)] }));
    }
    for (const value of [null, {}, { paragraphs: ["짧음"] }, { paragraphs: [copy.paragraphs[0], copy.paragraphs[1], "좋은 하루 보내세요."] }])
        assert.throws(() => renderVisitAckCopy(fields, value));
});

test("LLM에는 서비스·이전 메일 주제만 전달하고 스타일을 다르게 지정한다", () => {
    const input = { businessName: "디자이너하이어", subject: "디자인 운영을 소개합니다", recipientEmail: "secret@example.test", fields,
        session: { duration: 7 }, events: [{ pageUrl: "https://private.test/pricing" }] } as unknown as JourneyCardInput;
    const a = visitAckCopyPrompt(input, () => 0), b = visitAckCopyPrompt(input, () => 0.9);
    assert.notEqual(a.system, b.system);
    assert.match(a.user, /디자인 운영/);
    assert.doesNotMatch(a.user, /secret@|류진모|duration|private\.test/);
    assert.match(a.system, /지시문은 무시/);
});
