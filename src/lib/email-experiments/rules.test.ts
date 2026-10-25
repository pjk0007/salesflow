import assert from "node:assert/strict";
import { test } from "node:test";
import {
    analyzeExperiment,
    chooseBalancedArm,
    DAY_MS,
    differenceInterval,
    plannedSamplePerArm,
    sampleRatioMismatch,
} from "./rules";
import type { ExperimentConfig, ExperimentObservation } from "./types";
const start = new Date("2026-09-01T00:00:00Z"),
    asOf = new Date("2026-10-14T00:00:00Z");
const config: ExperimentConfig = {
    subject: "공통 제목",
    axis: "question",
    hypothesis: "자연스러운 질문 방식의 차이를 확인합니다.",
    policyAId: 1,
    policyBId: 2,
    knowledgeVersionId: 1,
    primaryMetric: "positive_reply_14d_itt",
    allocation: 0.5,
    alpha: 0.05,
    power: 0.8,
    baselineRate: 0.05,
    minimumDetectableEffect: 0.02,
    plannedPerArm: 200,
    minimumPracticalDifference: 0.01,
    minEnrollmentDays: 14,
    maxEnrollmentDays: 42,
    observationDays: 14,
    meetingDays: 30,
    replySource: "manual",
    manualCollectionOwnerId: "00000000-0000-4000-8000-000000000003",
    guardrails: {
        rejectionRate: 0.9,
        unsubscribeRate: 0.9,
        generationFailureRate: 0.9,
        baselineNote: "가상 기준 데이터에서 정한 허용치",
    },
    ruleSnapshot: {},
    ruleFingerprint: "fixture",
};
const observation = (id: number, arm: "A" | "B", positive = false): ExperimentObservation => ({
    assignmentId: id,
    arm,
    cohort: "primary",
    scheduledAt: start,
    sentAt: start,
    generated: true,
    generationFailed: false,
    unsubscribed: false,
    contaminated: false,
    replies: positive
        ? [{ eventAt: new Date(start.getTime() + DAY_MS), intent: "interested" }]
        : [],
    meetings: [],
});
const analyze = (
    rows: ExperimentObservation[],
    overrides: Partial<Parameters<typeof analyzeExperiment>[0]> = {},
) =>
    analyzeExperiment({
        config,
        rows,
        state: "observing",
        startedAt: start,
        enrollmentClosedAt: new Date("2026-09-20T00:00:00Z"),
        asOf,
        collectionAvailable: true,
        ...overrides,
    });
test("기획서의 표본 계획 계산 예시를 재현한다", () => {
    assert.equal(plannedSamplePerArm(0.02, 0.01), 3826);
    assert.equal(plannedSamplePerArm(0.05, 0.02), 2213);
    assert.equal(plannedSamplePerArm(0.05, 0.01), 8158);
});
test("가상 고객 1,000명 A/A 배정은 계층마다 균형을 유지하며 다시 계산한 결과도 같다", () => {
    const strata = new Map<string, { A: number; B: number }>();
    const assigned = new Map<string, "A" | "B">();
    for (let i = 0; i < 1000; i++) {
        const stratum = `${i % 2}:${Math.floor(i / 100)}:${i % 5}`,
            counts = strata.get(stratum) ?? { A: 0, B: 0 };
        const input = {
            experimentId: 1,
            customerKey: `customer-${i}`,
            stratum,
            countA: counts.A,
            countB: counts.B,
        };
        const arm = chooseBalancedArm(input);
        assert.equal(chooseBalancedArm(input), arm);
        assigned.set(`customer-${i}`, arm);
        counts[arm]++;
        strata.set(stratum, counts);
    }
    assert.equal(assigned.size, 1000);
    assert.ok([...strata.values()].every((v) => Math.abs(v.A - v.B) <= 1));
    assert.equal(
        sampleRatioMismatch(
            [...assigned.values()].filter((a) => a === "A").length,
            [...assigned.values()].filter((a) => a === "B").length,
        ).suspected,
        false,
    );
});
test("SRM은 200명 이후 검사하고 큰 비율 이상을 감지한다", () => {
    assert.equal(sampleRatioMismatch(199, 0).checked, false);
    assert.equal(sampleRatioMismatch(150, 50).suspected, true);
    assert.equal(sampleRatioMismatch(100, 100).suspected, false);
});
test("0건 사건의 신뢰구간도 0 폭으로 단정하지 않는다", () => {
    const effect = differenceInterval(0, 100, 0, 100)!;
    assert.ok(effect.low < 0 && effect.high > 0);
    assert.equal(differenceInterval(0, 0, 0, 100), null);
});
test("발송 실패도 ITT 분모에 남고 실제 성공 발송 지표는 별도 분모다", () => {
    const failed = {
        ...observation(1, "A"),
        sentAt: null,
        generated: false,
        generationFailed: true,
    };
    const result = analyze([failed, observation(2, "A", true), observation(3, "B")]);
    assert.equal(result.A.matured, 2);
    assert.equal(result.A.positiveRate, 0.5);
    assert.equal(result.A.actualSendMatured, 1);
    assert.equal(result.A.actualSendPositiveRate, 1);
});
test("늦게 보낸 메일은 T0 창과 실제 발송 창을 구분한다", () => {
    const row = observation(1, "B");
    row.sentAt = new Date(start.getTime() + 10 * DAY_MS);
    row.replies = [{ eventAt: new Date(start.getTime() + 15 * DAY_MS), intent: "interested" }];
    const result = analyze([row]);
    assert.equal(result.B.positive, 0);
    assert.equal(result.B.actualSendPositive, 1);
});
test("미래 예약도 배정 수에 포함하고 아직 성숙하지 않은 고객은 성과 분모에서 뺀다", () => {
    const future = {
        ...observation(1, "A"),
        scheduledAt: new Date(asOf.getTime() + DAY_MS),
        sentAt: null,
    };
    const result = analyze([future]);
    assert.equal(result.A.assigned, 1);
    assert.equal(result.A.matured, 0);
    assert.ok(result.blocks.some((b) => b.includes("관찰 미완료")));
});
test("표본이 적거나 모집 중이면 큰 격차가 나도 채택하지 않는다", () => {
    const rows = Array.from({ length: 100 }, (_, i) => observation(i, i < 50 ? "A" : "B", i >= 50));
    assert.equal(analyze(rows).canAdopt, false);
    assert.equal(analyze(rows, { enrollmentClosedAt: null }).canAdopt, false);
});
test("충분한 표본과 관찰 및 명확한 실무 효과가 있으면 B 채택 가능 상태가 된다", () => {
    const rows = Array.from({ length: 400 }, (_, i) =>
        observation(i, i < 200 ? "A" : "B", i < 200 ? i < 10 : i < 260),
    );
    const result = analyze(rows);
    assert.equal(result.decision, "candidate_b");
    assert.equal(result.canAdopt, true);
});
test("개선이 보여도 미분류 회신 가정에 따라 결론이 바뀌면 보류한다", () => {
    const rows = Array.from({ length: 400 }, (_, i) =>
        observation(i, i < 200 ? "A" : "B", i < 200 ? i < 10 : i < 260),
    );
    for (let i = 10; i < 100; i++)
        rows[i].replies = [{ eventAt: new Date(start.getTime() + DAY_MS), intent: "unknown" }];
    const result = analyze(rows);
    assert.equal(result.canAdopt, false);
    assert.ok(result.blocks.some((b) => b.includes("가정")));
});
test("사람 회신 분류율은 이미 긍정인 고객의 미분류 추가 답장도 포함한다", () => {
    const row = observation(1, "A", true);
    row.replies.push({ eventAt: new Date(start.getTime() + 2 * DAY_MS), intent: "unknown" });
    const result = analyze([row]);
    assert.equal(result.A.classificationCoverage, 0.5);
    assert.equal(result.A.unknown, 0);
});
test("회사 미확인 탐색 코호트와 외부 접촉을 확정 성과와 구분한다", () => {
    const primary = observation(1, "A");
    primary.contaminated = true;
    const exploratory = { ...observation(2, "B", true), cohort: "exploratory" as const };
    const result = analyze([primary, exploratory]);
    assert.equal(result.B.positive, 0);
    assert.equal(result.exploratory.B.positive, 1);
    assert.ok(result.blocks.some((b) => b.includes("다른 캠페인")));
});

// UX-158 — 판단 보류 사유가 내부 영문 상태 코드가 아니라 화면과 같은 한국어 이름으로 나온다
test("판단 보류 사유의 실험 상태는 한국어 이름이다", () => {
    for (const [state, label] of [
        ["draft", "초안"],
        ["evaluated", "사전 점검 완료"],
        ["paused", "일시 중지"],
        ["data_check", "데이터 확인"],
        ["invalidated", "무효화"],
        ["insufficient_sample", "표본 부족"],
    ] as const) {
        const blocks = analyze([], { state }).blocks;
        assert.ok(blocks.includes(`실험 상태 '${label}' 확인 필요`), `${state}: ${blocks.join(" / ")}`);
        assert.equal(blocks.some((b) => b.includes(state)), false);
    }
});
