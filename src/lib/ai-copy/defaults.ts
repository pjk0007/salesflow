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
