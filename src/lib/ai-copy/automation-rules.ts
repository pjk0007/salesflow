import { z } from "zod";
import { copyDiversity, percentile } from "./rules";
import { plannedSamplePerArm } from "../email-experiments/rules";
import type { CopyOutput, PolicySnapshot } from "./types";

export const AUTO_DAILY_CALLS = 180;
export const AUTO_DAILY_TOKENS = 300_000;
export const AUTO_SAMPLES = 80;
export const AUTO_REVIEWS = 40;
export const candidateSchema = z.object({
    instructions: z.string().trim().min(10).max(8000),
    reason: z.string().trim().min(10).max(1000),
});
const score = z.object({
    naturalness: z.number().int().min(1).max(5),
    factuality: z.number().int().min(1).max(5),
    purposeFit: z.number().int().min(1).max(5),
    criticalError: z.boolean(),
    unsupportedClaim: z.boolean(),
    notes: z.string().max(1500),
});
export const reviewSchema = z.object({ left: score, right: score });
export const replySchema = z.object({
    intent: z.enum(["interested", "neutral", "rejected", "unknown"]),
    confidence: z.number().min(0).max(1),
    quote: z.string().max(500),
    reason: z.string().min(5).max(1000),
});
export type AutoReview = z.infer<typeof reviewSchema>;
export function parseAutoJson(text: string) {
    return JSON.parse(
        text
            .trim()
            .replace(/^```(?:json)?\s*/, "")
            .replace(/\s*```$/, ""),
    );
}
export function samplePosition(index: number) {
    return {
        scenario: Math.floor(index / 4),
        repetition: Math.floor((index % 4) / 2),
        arm: (index % 2 === 0 ? "A" : "B") as "A" | "B",
    };
}
export function canonicalCompany(value: unknown) {
    if (typeof value !== "string") return null;
    const name = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    return name.length >= 2 &&
        name.length <= 200 &&
        !/^(없음|미상|미확인|개인|unknown|none|n\/a|-)$/.test(name) &&
        !name.includes("@")
        ? name
        : null;
}
/** 모집 전에 규모에 맞는 탐지 가능 차이를 정해 동결한다. 성과를 보고 표본을 줄이지 않는다. */
export function automaticSamplePlan(capacity: number, baseline = 0.05) {
    for (let effect = 0.02; effect <= 0.20001; effect += 0.005) {
        const rounded = Number(effect.toFixed(3)),
            perArm = plannedSamplePerArm(baseline, rounded);
        if (perArm * 2 <= capacity)
            return {
                baselineRate: baseline,
                minimumDetectableEffect: rounded,
                plannedPerArm: perArm,
            };
    }
    return null;
}
export function checkedReply(result: z.infer<typeof replySchema>, excerpt: string) {
    const quote = result.quote.trim();
    const verified = quote.length >= 3 && excerpt.includes(quote) && result.confidence >= 0.9;
    return { ...result, intent: verified ? result.intent : ("unknown" as const), quote };
}
export interface AutoSample {
    arm: "A" | "B";
    state: string;
    output: CopyOutput | null;
    attempts: {
        result: string;
        durationMs: number | null;
        promptTokens: number | null;
        completionTokens: number | null;
        usageKnown: boolean;
    }[];
}
export function assessAutomaticQuality(
    samples: AutoSample[],
    reviews: AutoReview[],
    policy: PolicySnapshot,
) {
    const A = samples.filter((s) => s.arm === "A"),
        B = samples.filter((s) => s.arm === "B");
    const blocks: string[] = [];
    if (A.length !== 40 || B.length !== 40 || samples.some((s) => s.state !== "ready" || !s.output))
        blocks.push("80건 생성·자동 검증 미완료");
    if (reviews.length !== AUTO_REVIEWS) blocks.push("자동 문구 검토 40회 미완료");
    const aScores = reviews.map((r, i) => (i % 2 === 0 ? r.left : r.right)),
        bScores = reviews.map((r, i) => (i % 2 === 0 ? r.right : r.left));
    const mean = (scores: typeof aScores, key: "naturalness" | "factuality" | "purposeFit") =>
        scores.length ? scores.reduce((n, s) => n + s[key], 0) / scores.length : 0;
    const means = {
        A: {
            naturalness: mean(aScores, "naturalness"),
            factuality: mean(aScores, "factuality"),
            purposeFit: mean(aScores, "purposeFit"),
        },
        B: {
            naturalness: mean(bScores, "naturalness"),
            factuality: mean(bScores, "factuality"),
            purposeFit: mean(bScores, "purposeFit"),
        },
    };
    if (bScores.some((s) => s.criticalError || s.unsupportedClaim))
        blocks.push("후보의 중대 오류·근거 없는 주장");
    if (
        Object.values(means.B).some((n) => n < 4) ||
        means.B.naturalness < means.A.naturalness - 0.2 ||
        means.B.factuality < means.A.factuality ||
        means.B.purposeFit < means.A.purposeFit - 0.2
    )
        blocks.push("후보 자동 품질 점수 미달");
    const diversity = copyDiversity(B.flatMap((s) => (s.output ? [s.output] : [])));
    if (
        diversity.duplicateRate === null ||
        diversity.duplicateRate > policy.targets.duplicateRate ||
        diversity.questionShare === null ||
        diversity.questionShare > policy.targets.questionShare
    )
        blocks.push("후보 문구 다양성 기준 미달");
    const latency = B.flatMap((s) =>
        s.attempts
            .filter((a) => a.result === "valid" && a.durationMs !== null)
            .map((a) => a.durationMs!),
    );
    const p95 = percentile(latency, 0.95),
        p99 = percentile(latency, 0.99);
    if (
        p95 === null ||
        p95 > policy.targets.p95Ms ||
        p99 === null ||
        p99 > policy.targets.p99Ms ||
        B.filter((s) => s.attempts[0]?.result === "valid").length / 40 <
            policy.targets.firstAttemptSuccess
    )
        blocks.push("후보 생성 속도·첫 성공률 기준 미달");
    const tokens = (rows: AutoSample[], key: "promptTokens" | "completionTokens") =>
        rows.flatMap((s) => s.attempts).reduce((n, a) => n + (a[key] ?? 0), 0);
    const inputA = tokens(A, "promptTokens"),
        inputB = tokens(B, "promptTokens"),
        outputA = tokens(A, "completionTokens"),
        outputB = tokens(B, "completionTokens");
    if (
        samples.some((s) => !s.attempts.length || s.attempts.some((a) => !a.usageKnown)) ||
        inputB > inputA * policy.targets.costRatio ||
        outputB > outputA * policy.targets.costRatio
    )
        blocks.push("사용량 미확인 또는 입력·출력 사용량 증가 기준 초과");
    return {
        passed: blocks.length === 0,
        blocks,
        means,
        diversity,
        p95Ms: p95,
        p99Ms: p99,
        p99Provisional: latency.length < 100,
        latencySamples: latency.length,
        inputA,
        inputB,
        outputA,
        outputB,
        method: "automated_review_v1",
        humanReview: false,
        controlledLoad: false,
    };
}
