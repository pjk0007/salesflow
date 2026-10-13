import type { CopyOutput, CopyPurpose, PerformanceTargets } from "./types";
import { copyDiversity, percentile } from "./rules";

export const EVALUATION_DATASET_VERSION = "copy-eval-2026-10-v1";
export const EVALUATION_SCENARIOS = [
    "기본적인 서비스 소개",
    "고객 정보 없음",
    "담당자 이름 없음",
    "긴 회사 설명",
    "같은 업종의 다른 회사",
    "직책만 알려진 고객",
    "확인되지 않은 제품 가격 문의",
    "오래된 제품 설명",
    "이전 제목에 금지 표현 포함",
    "참고 데이터에 지시문 포함",
    "제품과 관계없는 고객 정보",
    "한글과 영문이 섞인 회사명",
    "특수 문자가 포함된 이름",
    "고객 상황을 추측하기 쉬운 맥락",
    "서비스 이용 여부 불명확",
    "할인이나 무료 혜택을 요구하는 맥락",
    "회신 부담을 줄여야 하는 맥락",
    "비슷한 내용을 여러 번 설명한 맥락",
    "짧은 문의만 있는 맥락",
    "자료 확인 후 추가 설명이 필요한 맥락",
] as const;
export interface HumanReview {
    reviewerId: string;
    naturalness: number;
    factuality: number;
    purposeFit: number;
    criticalError: boolean;
}
export interface EvaluationItem {
    workspaceId: number;
    candidate: boolean;
    reviewRequired: boolean;
    state: string;
    output: CopyOutput | null;
    reviews: HumanReview[];
    resolution?: HumanReview;
    attempts: {
        result: string;
        durationMs: number | null;
        costKrw: number | null;
        usageKnown: boolean;
    }[];
    eligibleAt: Date;
    readyAt: Date | null;
}
export interface PerformanceEvidence {
    repeats: {
        durationMinutes: number;
        ratePerMinute: number;
        burstSize: number;
        initialConcurrency: number;
        sampleCount: number;
        completed: boolean;
    }[];
    cpu: string;
    ramMb: number;
    region: string;
    model: string;
    measuredAt: string;
    measurements: {
        latencies: number[];
        readyDelays: number[];
        firstAttemptSuccess: number | null;
        readyWithin30Minutes: number;
        p95Ms: number | null;
        p99Ms: number | null;
        queueP95Ms: number | null;
        failedJobs: number;
    };
}
export function evaluateCopyRun(
    items: EvaluationItem[],
    purpose: CopyPurpose,
    targets: PerformanceTargets,
    performance: PerformanceEvidence | null,
) {
    const blocks: string[] = [];
    const workspaces = [...new Set(items.map((i) => i.workspaceId))];
    if (
        items.length !== 400 ||
        workspaces.length !== 2 ||
        workspaces.some((w) => items.filter((i) => i.workspaceId === w).length !== 200)
    )
        blocks.push("자동 평가 400건과 두 사업의 균등 표본이 필요합니다.");
    if (items.some((i) => i.state !== "ready" || !i.output))
        blocks.push("자동 평가에 미완료 또는 검증 실패 문구가 있습니다.");
    const reviewItems = items.filter((i) => i.reviewRequired);
    if (reviewItems.length !== 80) blocks.push("사람 평가 대상 80건이 필요합니다.");
    const scores: HumanReview[] = [];
    const candidateScores: HumanReview[] = [];
    const candidatesByBusiness = new Map<number, HumanReview[]>();
    let missingReviews = 0,
        unresolved = 0;
    for (const item of reviewItems) {
        const distinct = [...new Map(item.reviews.map((r) => [r.reviewerId, r])).values()];
        if (distinct.length < 2) {
            missingReviews++;
            continue;
        }
        const pair = distinct.slice(0, 2);
        const conflict =
            ["naturalness", "factuality", "purposeFit"].some(
                (key) =>
                    Math.abs(pair[0][key as "naturalness"] - pair[1][key as "naturalness"]) >= 2,
            ) || pair[0].criticalError !== pair[1].criticalError;
        if (conflict && !item.resolution) {
            unresolved++;
            continue;
        }
        const score = item.resolution ?? {
            reviewerId: "paired",
            naturalness: (pair[0].naturalness + pair[1].naturalness) / 2,
            factuality: (pair[0].factuality + pair[1].factuality) / 2,
            purposeFit: (pair[0].purposeFit + pair[1].purposeFit) / 2,
            criticalError: pair.some((r) => r.criticalError),
        };
        scores.push(score);
        if (item.candidate) {
            candidateScores.push(score);
            const group = candidatesByBusiness.get(item.workspaceId) ?? [];
            group.push(score);
            candidatesByBusiness.set(item.workspaceId, group);
        }
    }
    if (missingReviews) blocks.push(`두 사람의 독립 평가가 부족한 문구 ${missingReviews}건`);
    if (unresolved) blocks.push(`평가 차이 합의가 필요한 문구 ${unresolved}건`);
    const ratings = (key: "naturalness" | "factuality" | "purposeFit") => ({
        average: candidateScores.length
            ? candidateScores.reduce((s, r) => s + r[key], 0) / candidateScores.length
            : null,
        atLeastFour: candidateScores.length
            ? candidateScores.filter((r) => r[key] >= 4).length / candidateScores.length
            : null,
    });
    const naturalness = ratings("naturalness"),
        factuality = ratings("factuality"),
        purposeFit = ratings("purposeFit");
    if (scores.some((s) => s.criticalError))
        blocks.push("사람 평가에서 중대한 오류가 확인됐습니다.");
    if (
        candidateScores.length &&
        (naturalness.average! < 4 ||
            naturalness.atLeastFour! < 0.9 ||
            factuality.atLeastFour! < 0.9 ||
            purposeFit.atLeastFour! < 0.9)
    )
        blocks.push("후보 문구 사람 평가의 자연스러움·사실성·목적 적합성 기준 미달");
    const humanByBusiness = workspaces.map((workspaceId) => {
        const group = candidatesByBusiness.get(workspaceId) ?? [];
        const average = group.length
            ? group.reduce((s, r) => s + r.naturalness, 0) / group.length
            : null;
        const qualityRates = ["naturalness", "factuality", "purposeFit"].map((key) =>
            group.length
                ? group.filter((r) => r[key as "naturalness"] >= 4).length / group.length
                : null,
        );
        if (group.length && (average! < 4 || qualityRates.some((r) => r! < 0.9)))
            blocks.push(`사업 ${workspaceId} 후보 문구의 사람 평가 기준 미달`);
        return {
            workspaceId,
            reviewedCases: group.length,
            naturalnessAverage: average,
            atLeastFour: {
                naturalness: qualityRates[0],
                factuality: qualityRates[1],
                purposeFit: qualityRates[2],
            },
        };
    });
    const diversity = workspaces.map((workspaceId) => {
        const outputs = items
            .filter((i) => i.workspaceId === workspaceId && i.candidate && i.output)
            .map((i) => i.output!);
        const value = copyDiversity(outputs);
        if (
            value.count < 100 ||
            value.duplicateRate! > targets.duplicateRate ||
            value.questionShare! > targets.questionShare
        )
            blocks.push(`사업 ${workspaceId} 후보 문구의 다양성 기준 미달`);
        return { workspaceId, ...value };
    });
    const attempts = items.flatMap((i) => i.attempts),
        firstAttempts = items.map((i) => i.attempts[0]).filter(Boolean);
    const latencies = attempts.filter((a) => a.durationMs !== null).map((a) => a.durationMs!);
    const p95Ms = percentile(latencies, 0.95),
        p99Ms = percentile(latencies, 0.99);
    const firstAttemptSuccess = firstAttempts.length
        ? firstAttempts.filter((a) => a.result === "valid").length / firstAttempts.length
        : null;
    const readyWithin30Minutes = items.length
        ? items.filter(
              (i) => i.readyAt && i.readyAt.getTime() - i.eligibleAt.getTime() <= 30 * 60_000,
          ).length / items.length
        : null;
    const queueP95Ms = percentile(
        items.filter((i) => i.readyAt).map((i) => i.readyAt!.getTime() - i.eligibleAt.getTime()),
        0.95,
    );
    if (
        p95Ms === null ||
        p95Ms > targets.p95Ms ||
        firstAttemptSuccess === null ||
        firstAttemptSuccess < targets.firstAttemptSuccess ||
        readyWithin30Minutes === null ||
        readyWithin30Minutes < targets.readyWithin30Minutes ||
        queueP95Ms === null ||
        queueP95Ms > targets.queueP95Ms
    )
        blocks.push("생성 속도 또는 준비 성공률 기준 미달·미측정");
    const p99Provisional = latencies.length < 1000;
    if (!p99Provisional && p99Ms! > targets.p99Ms) blocks.push("p99 생성 시간 기준 미달");
    const averageCost = (candidate: boolean, workspaceId?: number) => {
        const group = items.filter(
                (i) =>
                    i.candidate === candidate &&
                    (workspaceId === undefined || i.workspaceId === workspaceId),
            ),
            groupAttempts = group.flatMap((i) => i.attempts);
        if (!groupAttempts.length || groupAttempts.some((a) => !a.usageKnown || a.costKrw === null))
            return null;
        const valid = group.filter((i) => i.output).length;
        return valid ? groupAttempts.reduce((s, a) => s + a.costKrw!, 0) / valid : null;
    };
    const baselineCostKrw = averageCost(false),
        candidateCostKrw = averageCost(true);
    const costRatio =
        baselineCostKrw === 0 && candidateCostKrw === 0
            ? 1
            : baselineCostKrw !== null && baselineCostKrw > 0 && candidateCostKrw !== null
              ? candidateCostKrw / baselineCostKrw
              : null;
    if (costRatio === null) blocks.push("기준안과 후보안의 사용량·단가 확인 필요");
    else if (costRatio > targets.costRatio) blocks.push("유효 문구당 비용 기준 초과");
    const businessCosts = workspaces.map((workspaceId) => {
        const baseline = averageCost(false, workspaceId),
            candidate = averageCost(true, workspaceId);
        const ratio =
            baseline === 0 && candidate === 0
                ? 1
                : baseline !== null && baseline > 0 && candidate !== null
                  ? candidate / baseline
                  : null;
        if (ratio === null || ratio > targets.costRatio)
            blocks.push(`사업 ${workspaceId} 유효 문구당 비용 미측정·기준 초과`);
        return {
            workspaceId,
            baselineCostKrw: baseline,
            candidateCostKrw: candidate,
            costRatio: ratio,
        };
    });
    if (
        !performance ||
        performance.repeats.length !== 3 ||
        performance.repeats.some(
            (r) =>
                !r.completed ||
                r.durationMinutes < 30 ||
                r.ratePerMinute !== 6 ||
                r.burstSize !== 30 ||
                r.initialConcurrency !== 3 ||
                r.sampleCount < 210,
        ) ||
        !performance.cpu ||
        !performance.ramMb ||
        !performance.region ||
        !performance.model ||
        !performance.measuredAt
    )
        blocks.push("분당 6건 30분과 30건 순간 부하를 세 번 측정한 성능 근거 필요");
    const measured = performance?.measurements;
    if (
        !measured ||
        measured.p95Ms === null ||
        measured.p95Ms > targets.p95Ms ||
        measured.queueP95Ms === null ||
        measured.queueP95Ms > targets.queueP95Ms ||
        measured.firstAttemptSuccess === null ||
        measured.firstAttemptSuccess < targets.firstAttemptSuccess ||
        measured.readyWithin30Minutes < targets.readyWithin30Minutes
    )
        blocks.push("부하 중 속도·준비 성공률 기준 미달·미측정");
    const combinedP99 = measured ? percentile([...latencies, ...measured.latencies], 0.99) : p99Ms;
    const totalLatencySamples = latencies.length + (measured?.latencies.length ?? 0);
    if (totalLatencySamples >= 1000 && combinedP99! > targets.p99Ms)
        blocks.push("부하 포함 p99 생성 시간 기준 미달");
    return {
        passed: blocks.length === 0,
        blocks,
        purpose,
        automaticCases: items.length,
        validCases: items.filter((i) => i.state === "ready" && i.output).length,
        reviewedCases: scores.length,
        missingReviews,
        unresolved,
        naturalness,
        factuality,
        purposeFit,
        humanByBusiness,
        diversity,
        p95Ms,
        p99Ms,
        p99Provisional,
        latencySamples: latencies.length,
        firstAttemptSuccess,
        readyWithin30Minutes,
        queueP95Ms,
        baselineCostKrw,
        candidateCostKrw,
        costRatio,
        businessCosts,
        loadP95Ms: measured?.p95Ms ?? null,
        combinedP99,
        totalLatencySamples,
        combinedP99Provisional: totalLatencySamples < 1000,
    };
}
