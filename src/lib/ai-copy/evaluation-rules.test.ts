import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCopyRun, type EvaluationItem, type PerformanceEvidence } from "./evaluation-rules";
import { targetsFor } from "./defaults";
import { benchmarkSchedule } from "./benchmark";
const initial = new Date("2026-10-14T00:00:00Z");
function fixtures(): EvaluationItem[] {
    return [8, 9].flatMap((workspaceId) =>
        [false, true].flatMap((candidate) =>
            Array.from({ length: 100 }, (_, i) => ({
                workspaceId,
                candidate,
                reviewRequired: i % 5 === 0,
                state: "ready",
                output: {
                    subject: "가상 문구",
                    htmlBody: `가상 본문 ${workspaceId} ${candidate} ${i}`,
                    fingerprint: `${workspaceId}-${candidate}-${i}`,
                    question: `가상 질문 ${i}?`,
                },
                reviews:
                    i % 5 === 0
                        ? ["fixture-person-a", "fixture-person-b"].map((reviewerId) => ({
                              reviewerId,
                              naturalness: 4,
                              factuality: 4,
                              purposeFit: 4,
                              criticalError: false,
                          }))
                        : [],
                attempts: [
                    {
                        result: "valid",
                        durationMs: 12000,
                        costKrw: candidate ? 0.011 : 0.01,
                        usageKnown: true,
                    },
                ],
                eligibleAt: initial,
                readyAt: new Date(initial.getTime() + 15000),
            })),
        ),
    );
}
function evidence(): PerformanceEvidence {
    return {
        cpu: "fixture CPU",
        ramMb: 1024,
        region: "isolated fixture",
        model: "fixture model",
        measuredAt: initial.toISOString(),
        repeats: [0, 1, 2].map(() => ({
            durationMinutes: 30,
            ratePerMinute: 6,
            burstSize: 30,
            initialConcurrency: 3,
            sampleCount: 210,
            completed: true,
        })),
        measurements: {
            latencies: Array(630).fill(12000),
            readyDelays: Array(630).fill(15000),
            firstAttemptSuccess: 1,
            readyWithin30Minutes: 1,
            p95Ms: 12000,
            p99Ms: 12000,
            queueP95Ms: 15000,
            failedJobs: 0,
        },
    };
}
test("400건 고정 데이터와 80건 이중 평가 및 부하 근거를 모두 요구한다", () => {
    const report = evaluateCopyRun(fixtures(), "visit_ack", targetsFor("visit_ack"), evidence());
    assert.equal(report.passed, true);
    assert.equal(report.reviewedCases, 80);
    assert.equal(report.validCases, 400);
    assert.equal(report.combinedP99Provisional, false);
});
test("한 사업의 비용 초과를 다른 사업의 저렴한 비용으로 상쇄하지 않는다", () => {
    const rows = fixtures();
    for (const row of rows)
        row.attempts[0].costKrw = row.candidate ? (row.workspaceId === 8 ? 0.02 : 0) : 0.01;
    const report = evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence());
    assert.equal(report.costRatio, 1);
    assert.equal(report.passed, false);
    assert.ok(report.blocks.some((b) => b.includes("사업 8 유효 문구당 비용")));
});
test("한 사람이 두 번 평가하거나 평가가 없으면 승인할 수 없다", () => {
    const rows = fixtures();
    rows.forEach((r) => {
        r.reviews = r.reviews.map((v) => ({ ...v, reviewerId: "same-person" }));
    });
    assert.equal(
        evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence()).passed,
        false,
    );
    rows.forEach((r) => {
        r.reviews = [];
    });
    assert.equal(
        evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence()).reviewedCases,
        0,
    );
});
test("2점 차이와 중대한 오류 판단 차이는 합의 전 통과하지 않는다", () => {
    const rows = fixtures(),
        item = rows.find((r) => r.reviewRequired)!;
    item.reviews[0].naturalness = 5;
    item.reviews[1].naturalness = 3;
    const unresolved = evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence());
    assert.equal(unresolved.unresolved, 1);
    assert.equal(unresolved.passed, false);
    item.resolution = {
        reviewerId: "fixture-resolver",
        naturalness: 4,
        factuality: 4,
        purposeFit: 4,
        criticalError: false,
    };
    assert.equal(
        evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence()).passed,
        true,
    );
});
test("한 사업의 나쁜 평가가 다른 사업의 높은 평가에 가려지지 않는다", () => {
    const rows = fixtures(),
        selected = rows.filter((r) => r.candidate && r.workspaceId === 8 && r.reviewRequired);
    rows.forEach((r) =>
        r.reviews.forEach((v) => {
            v.naturalness = 5;
        }),
    );
    selected.slice(0, 4).forEach((r) =>
        r.reviews.forEach((v) => {
            v.factuality = 3;
        }),
    );
    const report = evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence());
    assert.ok(report.blocks.some((b) => b.includes("사업 8") && b.includes("사람 평가")));
});
test("본문 중복과 같은 질문의 편중을 사업별로 검출한다", () => {
    const rows = fixtures();
    rows.filter((r) => r.candidate && r.workspaceId === 8).forEach((r) => {
        r.output!.fingerprint = "same-body";
        r.output!.question = "같은 질문인가요?";
    });
    assert.ok(
        evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence()).blocks.some((b) =>
            b.includes("다양성"),
        ),
    );
});
test("실패 시도와 단가가 없는 시도의 비용을 0원으로 확정하지 않는다", () => {
    const rows = fixtures();
    rows[0].attempts.push({
        result: "provider_failed",
        durationMs: 100,
        costKrw: null,
        usageKnown: false,
    });
    const report = evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence());
    assert.equal(report.baselineCostKrw, null);
    assert.equal(report.passed, false);
});
test("타임아웃 시도의 지연도 99% 시간 측정에서 제외하지 않는다", () => {
    const rows = fixtures();
    for (let i = 0; i < 15; i++)
        rows[i].attempts.push({
            result: "timeout",
            durationMs: 45000,
            costKrw: 0.001,
            usageKnown: true,
        });
    const report = evaluateCopyRun(rows, "visit_ack", targetsFor("visit_ack"), evidence());
    assert.equal(report.combinedP99, 45000);
    assert.equal(report.passed, false);
});
test("실제 부하 측정 없이 품질 평가만으로 성능을 통과했다고 표시하지 않는다", () => {
    const report = evaluateCopyRun(fixtures(), "visit_ack", targetsFor("visit_ack"), null);
    assert.equal(report.passed, false);
    assert.equal(report.loadP95Ms, null);
});
test("부하 일정은 6건/분 30분과 30건 순간 부하를 세 번 예약한다", () => {
    const schedule = benchmarkSchedule(initial);
    assert.equal(schedule.length, 630);
    for (const repetition of [0, 1, 2]) {
        const group = schedule.filter((s) => s.repetition === repetition);
        assert.equal(group.length, 210);
        assert.equal(group[1].scheduledAt.getTime() - group[0].scheduledAt.getTime(), 10000);
        assert.equal(new Set(group.slice(180).map((s) => s.scheduledAt.getTime())).size, 1);
        assert.equal(group[180].scheduledAt.getTime() - group[0].scheduledAt.getTime(), 30 * 60000);
    }
});
