import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildCopyPrompt,
    copyDiversity,
    fingerprint,
    knowledgeSchema,
    normalizedBody,
    percentile,
    policySchema,
    targetsFor,
    validateCopy,
} from "./rules";
import type { PolicySnapshot } from "./types";

export const testPolicy = (purpose: PolicySnapshot["purpose"] = "visit_ack"): PolicySnapshot => ({
    purpose,
    provider: "claude",
    model: "claude-haiku-4-5",
    parameters: { maxOutputTokens: 2048, temperature: 0.8 },
    instructions: "정중하고 자연스러운 문장으로 작성하세요.",
    requiredMeanings: ["방문 감사", "추가 문의", "전화 또는 답장 안내"],
    forbiddenPhrases: ["지금 바로"],
    maxCharacters: purpose === "visit_ack" ? 600 : 2000,
    validatorVersion: "copy-v1",
    targets: targetsFor(purpose),
});
const thanks = {
    paragraphs: [
        "갑작스런 메일에도 사이트를 방문해 주셔서 감사합니다.",
        "살펴보시면서 더 궁금하셨던 점이 있으실까요?",
        "언제든 전화나 답장 주시면 친절히 안내드리겠습니다.",
    ],
};
test("버전 해시는 객체 키 순서와 무관하고 내용 변경에는 달라진다", () => {
    assert.equal(fingerprint({ a: 1, b: [2, 3] }), fingerprint({ b: [2, 3], a: 1 }));
    assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});
test("명시 모델을 고정하고 성능 기준 변경 사유를 요구한다", () => {
    assert.equal(policySchema.safeParse(testPolicy()).success, true);
    assert.equal(policySchema.safeParse({ ...testPolicy(), model: "자동선택" }).success, false);
    assert.equal(
        policySchema.safeParse({
            ...testPolicy(),
            targets: { ...targetsFor("visit_ack"), p95Ms: 20_000 },
        }).success,
        false,
    );
    assert.equal(
        policySchema.safeParse({
            ...testPolicy(),
            targets: {
                ...targetsFor("visit_ack"),
                p95Ms: 20_000,
                overrideReason: "긴 안내문 조건에서 재평가",
            },
        }).success,
        true,
    );
});
test("지식에는 근거와 확인 시점 및 사용 목적이 필요하다", () => {
    assert.equal(
        knowledgeSchema.safeParse({
            businessName: "가상 사업",
            claims: [
                {
                    text: "설명",
                    sourceUrl: "https://example.test/faq",
                    checkedAt: "2026-10-14T00:00:00Z",
                    purposes: ["initial_email"],
                },
            ],
        }).success,
        true,
    );
    assert.equal(
        knowledgeSchema.safeParse({ businessName: "가상 사업", claims: [{ text: "설명" }] })
            .success,
        false,
    );
});
test("감사 문구 의미를 검증하고 인사말은 코드에서 넣는다", () => {
    const output = validateCopy(
        testPolicy(),
        { system: "", user: "", greeting: "안녕하세요. 가상 고객님", fixedSubject: "감사합니다" },
        thanks,
    );
    assert.match(output.htmlBody, /^안녕하세요\. 가상 고객님/);
    assert.equal(output.subject, "감사합니다");
    assert.throws(() =>
        validateCopy(
            testPolicy(),
            { system: "", user: "" },
            {
                paragraphs: [
                    "방문해 주셔서 감사합니다.",
                    "가격 페이지에 오래 계셨네요.",
                    "전화나 답장으로 편히 문의해 주세요.",
                ],
            },
        ),
    );
    assert.throws(() =>
        validateCopy(
            testPolicy(),
            { system: "", user: "" },
            {
                paragraphs: [
                    "방문해 주셔서 감사합니다.",
                    "추가 설명이 궁금하신가요?",
                    "전화로 편히 문의해 주세요.",
                ],
            },
        ),
    );
});
test("일반 메일은 승인한 URL과 HTML 및 고정 제목을 검증한다", () => {
    const policy = testPolicy("initial_email"),
        context = {
            system: "",
            user: "",
            fixedSubject: "고정된 제목",
            allowedUrls: ["https://example.test"],
        };
    const output = validateCopy(policy, context, {
        subject: "모델이 만든 다른 제목",
        htmlBody: '<p>서비스 안내를 확인해 주세요.</p><a href="https://example.test">안내</a>',
    });
    assert.equal(output.subject, context.fixedSubject);
    assert.throws(() =>
        validateCopy(policy, context, {
            subject: "안내",
            htmlBody: '<p>안내를 확인해 주세요.</p><a href="https://other.test">링크</a>',
        }),
    );
    assert.throws(() =>
        validateCopy(policy, context, {
            subject: "안내",
            htmlBody: '<p onclick="x()">안내를 확인해 주세요.</p>',
        }),
    );
    assert.throws(() =>
        validateCopy(policy, context, {
            subject: "안내",
            htmlBody: "<p>자료를 확인해 주세요.</p><a href=https://other.test>안내</a>",
        }),
    );
});
test("용도가 다른 지식은 프롬프트에 넣지 않는다", () => {
    const prompt = buildCopyPrompt(
        testPolicy(),
        {
            businessName: "가상 사업",
            claims: [
                {
                    text: "초기 메일 전용 문구",
                    sourceUrl: "https://example.test",
                    checkedAt: "2026-10-14T00:00:00Z",
                    purposes: ["initial_email"],
                },
            ],
        },
        { system: "기본", user: "가상 맥락" },
    );
    assert.doesNotMatch(prompt.system, /초기 메일 전용 문구/);
});
test("다양성은 인사와 이름을 제거해 계산하며 빈 데이터는 0으로 표시하지 않는다", () => {
    assert.equal(
        normalizedBody("안녕하세요. 가상 고객님\n<p>본문 하나입니다.</p>"),
        "본문 하나입니다.",
    );
    const output = validateCopy(testPolicy(), { system: "", user: "" }, thanks);
    assert.equal(copyDiversity([output, { ...output }]).duplicateRate, 0.5);
    assert.equal(copyDiversity([]).duplicateRate, null);
    assert.equal(percentile([], 0.95), null);
    assert.equal(percentile([4, 1, 2, 3], 0.95), 4);
});
test("한 문단에 인사와 본문이 함께 있어도 본문을 버리지 않고 이름만 제거한다", () => {
    const first =
        "<p>안녕하세요, 가상고객님. 서비스 안내를 보내드립니다. 더 궁금한 점이 있으실까요?</p>";
    const second =
        "<p>안녕하세요, 다른고객님. 서비스 안내를 보내드립니다. 더 궁금한 점이 있으실까요?</p>";
    assert.equal(normalizedBody(first), "서비스 안내를 보내드립니다. 더 궁금한 점이 있으실까요?");
    assert.equal(normalizedBody(first), normalizedBody(second));
    assert.doesNotThrow(() =>
        validateCopy(
            testPolicy("initial_email"),
            { system: "", user: "" },
            { subject: "안내", htmlBody: first },
        ),
    );
});
