import type { CopyPurpose, PerformanceTargets } from "./types";
/** 문제 버전 차단 이유의 최소 글자 수(앞뒤 공백 제외). 서버 검사와 차단 확인창이 함께 쓴다. */
export const BLOCK_REASON_MIN_LENGTH = 10;
export const targetsFor = (purpose: CopyPurpose): PerformanceTargets => ({
    p95Ms: purpose === "visit_ack" ? 15_000 : 30_000,
    p99Ms: purpose === "visit_ack" ? 30_000 : 45_000,
    firstAttemptSuccess: 0.95,
    readyWithin30Minutes: 0.99,
    queueP95Ms: 300_000,
    duplicateRate: 0.02,
    questionShare: 0.2,
    costRatio: 1.2,
});

// 퍼센트 칸(입력×0.01)의 부동소수 오차(95×0.01=0.9500000000000001)를 기준 변경으로 보지 않는다(UX-243).
const TARGET_PRECISION = 1e6;
export const roundTarget = (value: number) => Math.round(value * TARGET_PRECISION) / TARGET_PRECISION;

/** 비교·지문용으로 숫자 기준을 반올림한다. 저장된 버전 값 자체는 바꾸지 않는다. */
export function normalizeTargets(targets: PerformanceTargets): PerformanceTargets {
    return Object.fromEntries(
        Object.entries(targets).map(([key, value]) => [
            key,
            typeof value === "number" ? roundTarget(value) : value,
        ]),
    ) as unknown as PerformanceTargets;
}

/** 목적의 기본 성능 기준과 (반올림 오차를 빼고) 같은지. */
export function targetsMatchDefaults(targets: PerformanceTargets, purpose: CopyPurpose) {
    return Object.entries(targetsFor(purpose)).every(
        ([key, value]) =>
            roundTarget(targets[key as keyof PerformanceTargets] as number) === roundTarget(value),
    );
}
