import type { CopyPurpose, PerformanceTargets } from "./types";
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
