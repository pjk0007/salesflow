import assert from "node:assert/strict";
import { test } from "node:test";
import {
    assessAutomaticQuality,
    automaticSamplePlan,
    canonicalCompany,
    checkedReply,
    samplePosition,
    type AutoSample,
    type AutoReview,
} from "./automation-rules";
import { targetsFor } from "./rules";
import type { PolicySnapshot } from "./types";

function fixture() {
    const samples: AutoSample[] = Array.from({ length: 80 }, (_, i) => ({
        arm: i % 2 === 0 ? "A" : "B",
        state: "ready",
        output: {
            subject: "가상 제목",
            htmlBody: `가상 본문 ${i}`,
            fingerprint: `body${i}`,
            question: `질문 ${i}?`,
        },
        attempts: [
            {
                result: "valid",
                durationMs: 100,
                promptTokens: 100,
                completionTokens: 50,
                usageKnown: true,
            },
        ],
    }));
    const score = {
        naturalness: 4,
        factuality: 5,
        purposeFit: 4,
        criticalError: false,
        unsupportedClaim: false,
        notes: "합성 경계 검사 점수입니다.",
    };
    const reviews: AutoReview[] = Array.from({ length: 40 }, () => ({
        left: { ...score },
        right: { ...score },
    }));
    const policy: PolicySnapshot = {
        purpose: "initial_email",
        provider: "claude",
        model: "claude-haiku-4-5",
        parameters: { maxOutputTokens: 2048, temperature: 0.8 },
        instructions: "가상 제품을 자연스럽게 소개하세요.",
        requiredMeanings: ["기존 목적 유지"],
        forbiddenPhrases: [],
        maxCharacters: 2000,
        validatorVersion: "copy-v1",
        targets: targetsFor("initial_email"),
    };
    return { samples, reviews, policy };
}
test("자동 평가는 사람 검수와 부하 시험을 거친 것으로 기록하지 않는다", () => {
    const f = fixture(),
        report = assessAutomaticQuality(f.samples, f.reviews, f.policy);
    assert.equal(report.passed, true);
    assert.equal(report.humanReview, false);
    assert.equal(report.controlledLoad, false);
    assert.equal(report.p99Provisional, true);
});
test("후보의 근거 없는 주장 하나라도 자동 평가를 보류한다", () => {
    const f = fixture();
    f.reviews[0].right.unsupportedClaim = true;
    assert.equal(assessAutomaticQuality(f.samples, f.reviews, f.policy).passed, false);
});
test("눈가림 순서가 뒤집힌 검토에서도 후보 오류를 놓치지 않는다", () => {
    const f = fixture();
    f.reviews[1].left.criticalError = true;
    assert.equal(assessAutomaticQuality(f.samples, f.reviews, f.policy).passed, false);
});
test("다양성·속도·사용량이 미달이거나 미측정이면 통과하지 않는다", () => {
    const f = fixture();
    for (const s of f.samples)
        if (s.arm === "B") {
            s.output!.fingerprint = "same";
            s.attempts[0].durationMs = 45001;
            s.attempts[0].promptTokens = 200;
        }
    const report = assessAutomaticQuality(f.samples, f.reviews, f.policy);
    assert.ok(report.blocks.length >= 3);
    f.samples[0].attempts[0].usageKnown = false;
    assert.ok(
        assessAutomaticQuality(f.samples, f.reviews, f.policy).blocks.some((s) =>
            s.includes("사용량"),
        ),
    );
});
test("AI의 높은 점수만으로 회신을 긍정으로 만들지 않고 실제 인용을 확인한다", () => {
    const result = {
        intent: "interested" as const,
        confidence: 0.99,
        quote: "자료 보내주세요",
        reason: "자료 요청이 명확합니다.",
    };
    assert.equal(checkedReply(result, "감사합니다").intent, "unknown");
    assert.equal(checkedReply({ ...result, confidence: 0.5 }, "자료 보내주세요").intent, "unknown");
    assert.equal(checkedReply(result, "자료 보내주세요").intent, "interested");
});
test("모집 전 발신 규모에 맞는 계획을 만들고 작은 표본은 보류한다", () => {
    assert.equal(automaticSamplePlan(10), null);
    const plan = automaticSamplePlan(420)!;
    assert.ok(plan.plannedPerArm * 2 <= 420);
    assert.ok(plan.minimumDetectableEffect > 0.02);
    assert.equal(automaticSamplePlan(10000)!.minimumDetectableEffect, 0.02);
});
test("개인 메일 주소나 미상 회사명을 확인된 회사로 가져오지 않는다", () => {
    for (const name of ["개인", "미상", "-", "a@gmail.com", null])
        assert.equal(canonicalCompany(name), null);
    assert.equal(canonicalCompany("  가상   회사 "), "가상 회사");
    assert.deepEqual(samplePosition(79), { scenario: 19, repetition: 1, arm: "B" });
});
