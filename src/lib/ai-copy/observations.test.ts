import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCopyObservations, type ObservedCopy } from "./observations";
import { targetsFor } from "./rules";

const now = new Date("2026-10-14T01:00:00Z");
const then = new Date("2026-09-20T01:00:00Z");
function row(overrides: Partial<ObservedCopy> = {}): ObservedCopy {
    return {
        id: 1,
        workspace_id: 8,
        workspace_name: "가상 사업",
        purpose: "initial_email",
        policy_version_id: null,
        policy_name: null,
        rule_id: 1,
        rule_name: "가상 규칙",
        assignment_id: null,
        superseded_by_id: null,
        state: "ready",
        created_at: then,
        eligible_at: then,
        ready_at: new Date(then.getTime() + 10000),
        output: {
            subject: "가상 제목",
            htmlBody: "가상 본문",
            fingerprint: "one",
            question: "어떤가요?",
        },
        targets: targetsFor("initial_email"),
        attempts: 1,
        validation_failures: 0,
        first_result: "valid",
        duration_ms: 10000,
        cost_krw: "0.5",
        cost_known: true,
        recipient_email: "person@customer.test",
        send_log_id: 1,
        sent_at: then,
        status: "sent",
        replies: [],
        ...overrides,
    };
}

test("평소 발송만으로 품질과 14일 회신이 집계되며 준비 중인 고객은 회신율에서 제외한다", () => {
    const report = summarizeCopyObservations(
        [
            row({ replies: [{ id: 1, receivedAt: "2026-09-21T01:00:00Z" }] }),
            row({
                id: 2,
                recipient_email: "new@customer.test",
                sent_at: now,
                created_at: now,
                eligible_at: now,
                ready_at: now,
            }),
        ],
        now,
    );
    assert.equal(report.purposes[0].jobs, 2);
    assert.equal(report.groups[0].sent, 2);
    assert.equal(report.groups[0].matured, 1);
    assert.equal(report.groups[0].humanReplies, 1);
    assert.equal(report.groups[0].humanReplyRate, 1);
    assert.equal(report.groups[0].awaitingObservation, 1);
});

test("동일 고객과 실험 배정은 평소 발송의 분모에 중복 편입하지 않는다", () => {
    const report = summarizeCopyObservations(
        [
            row(),
            row({ id: 2, recipient_email: " PERSON@CUSTOMER.TEST " }),
            row({ id: 3, assignment_id: 100, recipient_email: "experiment@customer.test" }),
        ],
        now,
    );
    assert.equal(report.groups[0].sent, 1);
    assert.equal(report.purposes[0].jobs, 3);
});

test("14일 창 밖의 회신과 아직 관찰이 끝나지 않은 회신으로 성과를 부풀리지 않는다", () => {
    const report = summarizeCopyObservations(
        [
            row({
                replies: [
                    { id: 1, receivedAt: "2026-09-19T01:00:00Z" },
                    { id: 2, receivedAt: "2026-10-04T01:00:00Z" },
                ],
            }),
        ],
        now,
    );
    assert.equal(report.groups[0].humanReplies, 0);
    assert.equal(report.groups[0].humanReplyRate, 0);
    assert.equal(summarizeCopyObservations([], now).purposes[0].firstAttemptSuccess, null);
});

test("대체 전 작업의 비용도 보존하고 일반 성과에서는 최신 작업만 본다", () => {
    const report = summarizeCopyObservations(
        [
            row({ superseded_by_id: 2 }),
            row({ id: 2, cost_krw: "1", recipient_email: "second@customer.test" }),
        ],
        now,
    );
    assert.equal(report.purposes[0].costKrw, 1.5);
    assert.equal(report.groups[0].sent, 1);
});

test("첫 시도 실패 후 성공, 장시간 보류와 미확인 비용을 자동 관찰에서 숨기지 않는다", () => {
    const report = summarizeCopyObservations(
        [
            row({ first_result: "provider_failed", attempts: 2 }),
            row({ id: 2, state: "held", ready_at: null, cost_krw: null, cost_known: false }),
        ],
        now,
    ).purposes[0];
    assert.equal(report.firstAttemptSuccess, 0.5);
    assert.equal(report.readyWithin30Minutes, 0.5);
    assert.equal(report.held, 1);
    assert.equal(report.costKrw, null);
    assert.equal(report.unknownCostJobs, 1);
    assert.equal(report.p95ReadyMs, 10000);
});
