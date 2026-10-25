import test from "node:test";
import assert from "node:assert/strict";
import { targetsFor } from "../../../lib/ai-copy/defaults";
import { policySchema } from "../../../lib/ai-copy/rules";
import { DEFAULT_MEANINGS, switchPurpose, targetFromInput } from "./policy-form";

test("UX-243 퍼센트 칸: 95·70·2·20·120%가 오차 없이 저장되고 빈 칸은 0으로 바뀌지 않는다", () => {
    assert.equal(targetFromInput("95", 0.01), 0.95);
    assert.equal(targetFromInput("70", 0.01), 0.7);
    assert.equal(targetFromInput("2", 0.01), 0.02);
    assert.equal(targetFromInput("20", 0.01), 0.2);
    assert.equal(targetFromInput("120", 0.01), 1.2);
    assert.equal(targetFromInput("15.5", 1000), 15500);
    assert.equal(targetFromInput("", 0.01), null);
    assert.equal(targetFromInput("abc", 0.01), null);
});

test("UX-243 서버: 기본값 재입력(오차 포함)은 사유 불필요, 실제 변경(90%)은 사유 요구 유지", () => {
    const base = {
        purpose: "visit_ack" as const,
        provider: "claude",
        model: "claude-haiku-4-5",
        parameters: { maxOutputTokens: 2048, temperature: 0.8 },
        instructions: "정중한 실무자의 말투로 짧게 변주하세요.",
        requiredMeanings: ["방문 감사"],
        forbiddenPhrases: [],
        maxCharacters: 600,
        validatorVersion: "copy-v1",
    };
    const issues = (targets: object) =>
        policySchema.safeParse({ ...base, targets }).error?.issues.map((i) => i.message) ?? [];
    const sticky = { ...targetsFor("visit_ack"), firstAttemptSuccess: 95 * 0.01, questionShare: 20 * 0.01 };
    assert.notEqual(sticky.firstAttemptSuccess, 0.95, "부동소수 오차가 있는 값으로 시험");
    assert.ok(!issues(sticky).includes("기본 성능 기준 변경 사유를 기록해 주세요."));
    assert.ok(issues({ ...targetsFor("visit_ack"), firstAttemptSuccess: 0.9 }).includes("기본 성능 기준 변경 사유를 기록해 주세요."));
});

test("UX-245 목적 전환: 기본값만 바뀌고 고친 의미·기준은 보존, 방문 감사 글자 수 상한만 적용", () => {
    const fresh = switchPurpose(
        { meanings: DEFAULT_MEANINGS.visit_ack, maxCharacters: 600, targets: targetsFor("visit_ack") },
        "visit_ack",
        "initial_email",
    );
    assert.equal(fresh.meanings, DEFAULT_MEANINGS.initial_email, "새 작성은 기본 문장 전환 유지");
    assert.equal(fresh.maxCharacters, 2000);
    assert.deepEqual(fresh.targets, targetsFor("initial_email"));

    const edited = { ...targetsFor("initial_email"), p95Ms: 20_000, overrideReason: "실측 근거" };
    const kept = switchPurpose(
        { meanings: "고객 업종에 맞춘 사례 소개", maxCharacters: 3000, targets: edited },
        "initial_email",
        "visit_ack",
    );
    assert.equal(kept.meanings, "고객 업종에 맞춘 사례 소개");
    assert.equal(kept.maxCharacters, 600, "방문 감사 상한을 넘으면 낮춘다");
    assert.deepEqual(kept.targets, edited, "변경 사유 포함 보존");

    assert.equal(
        switchPurpose({ meanings: "직접 쓴 의미", maxCharacters: 500, targets: targetsFor("visit_ack") }, "visit_ack", "initial_email").maxCharacters,
        500,
        "상한 안의 직접 입력은 유지",
    );
});

test("UX-243 비교 평가 지문: 오차만 다른 기존 저장 기준도 같은 기준으로 본다", async () => {
    const { normalizeTargets } = await import("../../../lib/ai-copy/defaults");
    const { fingerprint } = await import("../../../lib/ai-copy/rules");
    const stored = { ...targetsFor("initial_email"), firstAttemptSuccess: 95 * 0.01 };
    assert.equal(fingerprint(normalizeTargets(stored)), fingerprint(normalizeTargets(targetsFor("initial_email"))));
    assert.notEqual(
        fingerprint(normalizeTargets({ ...stored, firstAttemptSuccess: 0.9 })),
        fingerprint(normalizeTargets(targetsFor("initial_email"))),
    );
});
