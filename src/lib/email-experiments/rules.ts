import { createHash } from "node:crypto";
import { z } from "zod";
import type {
    ArmSummary,
    ExperimentArm,
    ExperimentConfig,
    ExperimentObservation,
    ExperimentState,
} from "./types";
export { plannedSamplePerArm } from "./sample-size";
export const DAY_MS = 24 * 3600_000;
export const ACTIVE_EXPERIMENT_STATES: ExperimentState[] = [
    "running",
    "paused",
    "enrollment_closed",
    "observing",
    "decision_ready",
    "data_check",
    "insufficient_sample",
];
const Z95 = 1.959963984540054;
export const SRM_P_THRESHOLD = 0.0005;
export const experimentInputSchema = z
    .object({
        workspaceId: z.number().int().positive(),
        ruleId: z.number().int().positive(),
        name: z.string().trim().min(1).max(120),
        subject: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .refine(
                (s) => !/[<>\r\n]|##|\{\{/.test(s),
                "두 집단에 공통으로 쓸 고정 제목을 적어 주세요.",
            ),
        axis: z.enum(["opening", "question", "tone", "length"]),
        hypothesis: z.string().trim().min(10).max(1000),
        policyAId: z.number().int().positive(),
        policyBId: z.number().int().positive(),
        knowledgeVersionId: z.number().int().positive(),
        baselineRate: z.number().gt(0).lt(1),
        minimumDetectableEffect: z.number().gt(0).lt(1),
        minimumPracticalDifference: z.number().gt(0).lt(1),
        replySource: z.enum(["connected", "manual"]),
        manualCollectionOwnerId: z.uuid().nullable(),
        guardrails: z.object({
            rejectionRate: z.number().min(0).max(1),
            unsubscribeRate: z.number().min(0).max(1),
            generationFailureRate: z.number().min(0).max(1),
            baselineNote: z.string().trim().min(10).max(1000),
        }),
    })
    .superRefine((v, ctx) => {
        if (v.baselineRate + v.minimumDetectableEffect >= 1)
            ctx.addIssue({
                code: "custom",
                path: ["minimumDetectableEffect"],
                message: "기준율과 탐지할 차이의 합은 100%보다 작아야 합니다.",
            });
        if (v.policyAId === v.policyBId)
            ctx.addIssue({
                code: "custom",
                path: ["policyBId"],
                message: "서로 다른 작성 지침을 선택해 주세요.",
            });
        if (v.replySource === "manual" && !v.manualCollectionOwnerId)
            ctx.addIssue({
                code: "custom",
                path: ["manualCollectionOwnerId"],
                message: "수동 회신 기록 담당자를 지정해 주세요.",
            });
    });
export function chooseBalancedArm(input: {
    experimentId: number;
    customerKey: string;
    stratum: string;
    countA: number;
    countB: number;
}): ExperimentArm {
    if (input.countA < input.countB) return "A";
    if (input.countB < input.countA) return "B";
    return createHash("sha256")
        .update(JSON.stringify([input.experimentId, input.stratum, input.customerKey]))
        .digest()[0] %
        2 ===
        0
        ? "A"
        : "B";
}
export function wilsonInterval(successes: number, total: number): [number, number] | null {
    if (total <= 0) return null;
    const p = successes / total,
        z2 = Z95 ** 2,
        denominator = 1 + z2 / total;
    const center = (p + z2 / (2 * total)) / denominator;
    const margin = (Z95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total ** 2))) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
/** Newcombe의 독립 Wilson 구간 결합. 이벤트 0건에서도 불확실성을 남긴다. */
export function differenceInterval(a: number, nA: number, b: number, nB: number) {
    const ia = wilsonInterval(a, nA),
        ib = wilsonInterval(b, nB);
    if (!ia || !ib) return null;
    const pA = a / nA,
        pB = b / nB,
        difference = pB - pA;
    return {
        difference,
        low: Math.max(-1, difference - Math.hypot(pB - ib[0], ia[1] - pA)),
        high: Math.min(1, difference + Math.hypot(ib[1] - pB, pA - ia[0])),
        relativeLift: pA === 0 ? null : difference / pA,
    };
}
function erfc(x: number) {
    const z = Math.abs(x),
        t = 1 / (1 + 0.5 * z);
    const value =
        t *
        Math.exp(
            -z * z -
                1.26551223 +
                t *
                    (1.00002368 +
                        t *
                            (0.37409196 +
                                t *
                                    (0.09678418 +
                                        t *
                                            (-0.18628806 +
                                                t *
                                                    (0.27886807 +
                                                        t *
                                                            (-1.13520398 +
                                                                t *
                                                                    (1.48851587 +
                                                                        t *
                                                                            (-0.82215223 +
                                                                                t *
                                                                                    0.17087277)))))))),
        );
    return x >= 0 ? value : 2 - value;
}
export function sampleRatioMismatch(a: number, b: number) {
    const total = a + b;
    if (total < 200) return { checked: false, suspected: false, pValue: null };
    const chiSquared = (a - b) ** 2 / total,
        pValue = Math.min(1, erfc(Math.sqrt(chiSquared / 2)));
    return { checked: true, suspected: pValue < SRM_P_THRESHOLD, pValue };
}
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
function summarize(
    rows: ExperimentObservation[],
    asOf: Date,
    cohort: "primary" | "exploratory",
    arm: ExperimentArm,
): ArmSummary {
    const assigned = rows.filter((r) => r.arm === arm && r.cohort === cohort);
    const matured = assigned.filter((r) => r.scheduledAt.getTime() + 14 * DAY_MS <= asOf.getTime());
    const replies = (r: ExperimentObservation, start: Date) =>
        r.replies.filter(
            (e) =>
                e.eventAt >= start &&
                e.eventAt.getTime() < start.getTime() + 14 * DAY_MS &&
                e.eventAt <= asOf,
        );
    const human = matured.filter((r) => replies(r, r.scheduledAt).length > 0);
    const positive = matured.filter((r) =>
        replies(r, r.scheduledAt).some((e) => e.intent === "interested"),
    );
    const unknown = human.filter(
        (r) =>
            !replies(r, r.scheduledAt).some((e) => e.intent === "interested") &&
            replies(r, r.scheduledAt).some((e) => e.intent === "unknown"),
    );
    const humanReplyEvents = matured.flatMap((r) => replies(r, r.scheduledAt));
    const unclassifiedReplies = humanReplyEvents.filter((r) => r.intent === "unknown");
    const sentMatured = assigned.filter(
        (r) => r.sentAt && r.sentAt.getTime() + 14 * DAY_MS <= asOf.getTime(),
    );
    const sentPositive = sentMatured.filter((r) =>
        replies(r, r.sentAt!).some((e) => e.intent === "interested"),
    );
    const meetingMatured = assigned.filter(
        (r) => r.scheduledAt.getTime() + 30 * DAY_MS <= asOf.getTime(),
    );
    return {
        assigned: assigned.length,
        matured: matured.length,
        generated: assigned.filter((r) => r.generated).length,
        generationFailures: matured.filter((r) => r.generationFailed).length,
        sent: assigned.filter((r) => r.sentAt && r.sentAt <= asOf).length,
        humanReplies: human.length,
        positive: positive.length,
        unknown: unknown.length,
        humanReplyEvents: humanReplyEvents.length,
        unclassifiedReplies: unclassifiedReplies.length,
        rejected: matured.filter((r) =>
            replies(r, r.scheduledAt).some((e) => e.intent === "rejected"),
        ).length,
        unsubscribed: matured.filter((r) => r.unsubscribed).length,
        contaminated: matured.filter((r) => r.contaminated).length,
        actualSendMatured: sentMatured.length,
        actualSendPositive: sentPositive.length,
        meetings30d: meetingMatured.filter((r) =>
            r.meetings.some(
                (at) =>
                    at >= r.scheduledAt &&
                    at.getTime() < r.scheduledAt.getTime() + 30 * DAY_MS &&
                    at <= asOf,
            ),
        ).length,
        meetingMatured: meetingMatured.length,
        positiveRate: ratio(positive.length, matured.length),
        classificationCoverage: ratio(
            humanReplyEvents.length - unclassifiedReplies.length,
            humanReplyEvents.length,
        ),
        actualSendPositiveRate: ratio(sentPositive.length, sentMatured.length),
    };
}
function conclusion(effect: ReturnType<typeof differenceInterval>, minimum: number) {
    if (!effect) return "undetermined" as const;
    if (effect.low > 0 && effect.difference >= minimum) return "candidate_b" as const;
    if (effect.high < 0 && -effect.difference >= minimum) return "baseline_a" as const;
    return "undetermined" as const;
}
export function analyzeExperiment(input: {
    config: ExperimentConfig;
    rows: ExperimentObservation[];
    state: ExperimentState;
    startedAt: Date | null;
    enrollmentClosedAt: Date | null;
    asOf: Date;
    collectionAvailable: boolean;
}) {
    const { config, asOf } = input,
        A = summarize(input.rows, asOf, "primary", "A"),
        B = summarize(input.rows, asOf, "primary", "B");
    const effect = differenceInterval(A.positive, A.matured, B.positive, B.matured);
    const srm = sampleRatioMismatch(A.assigned, B.assigned),
        blocks: string[] = [];
    if (!input.collectionAvailable) blocks.push("회신 수집 연결 또는 수동 수집 담당자 확인 필요");
    if (
        !input.startedAt ||
        asOf.getTime() - input.startedAt.getTime() < config.minEnrollmentDays * DAY_MS
    )
        blocks.push("최소 14일 모집 기간 미충족");
    if (!input.enrollmentClosedAt) blocks.push("모집 진행 중에는 우열을 확정하지 않습니다.");
    if (
        input.rows.some(
            (r) => r.cohort === "primary" && r.scheduledAt.getTime() + 14 * DAY_MS > asOf.getTime(),
        )
    )
        blocks.push("마지막 배정 고객의 14일 관찰 미완료");
    if (A.matured < config.plannedPerArm || B.matured < config.plannedPerArm)
        blocks.push("계획 표본 부족");
    if (srm.suspected) blocks.push("A/B 배정 비율 이상 의심");
    for (const [label, group] of [
        ["A", A],
        ["B", B],
    ] as const) {
        if (group.humanReplies > 0 && (group.classificationCoverage ?? 0) < 0.95)
            blocks.push(`${label} 사람 회신 의도 분류 95% 미달`);
        if (group.contaminated > 0) blocks.push(`${label} 고객의 다른 캠페인 접촉 확인 필요`);
        if (
            group.matured > 0 &&
            (group.rejected / group.matured > config.guardrails.rejectionRate ||
                group.unsubscribed / group.matured > config.guardrails.unsubscribeRate ||
                group.generationFailures / group.matured > config.guardrails.generationFailureRate)
        )
            blocks.push(`${label} 사전 설정한 거절·수신거부·생성 실패 기준 초과`);
    }
    const worstForB = differenceInterval(A.positive + A.unknown, A.matured, B.positive, B.matured);
    const bestForB = differenceInterval(A.positive, A.matured, B.positive + B.unknown, B.matured);
    const nominal = conclusion(effect, config.minimumPracticalDifference);
    if (
        conclusion(worstForB, config.minimumPracticalDifference) !==
        conclusion(bestForB, config.minimumPracticalDifference)
    )
        blocks.push("미분류 회신의 가정에 따라 결론이 바뀝니다.");
    if (
        [
            "draft",
            "evaluated",
            "paused",
            "data_check",
            "invalidated",
            "insufficient_sample",
        ].includes(input.state)
    )
        blocks.push(`실험 상태 ${input.state} 확인 필요`);
    const decision = blocks.length ? "undetermined" : nominal;
    return {
        asOf: asOf.toISOString(),
        A,
        B,
        exploratory: {
            A: summarize(input.rows, asOf, "exploratory", "A"),
            B: summarize(input.rows, asOf, "exploratory", "B"),
        },
        effect,
        srm,
        worstForB,
        bestForB,
        blocks,
        decision,
        canAdopt: decision === "candidate_b" && blocks.length === 0,
        label: blocks.some((b) => b.includes("표본 부족"))
            ? "표본 부족"
            : blocks.length
              ? "판단 보류"
              : decision === "candidate_b"
                ? "B 개선 확인"
                : decision === "baseline_a"
                  ? "A 우세"
                  : "우열 미확정",
    };
}
