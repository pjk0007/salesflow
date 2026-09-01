import { test } from "node:test";
import assert from "node:assert";
import { nextStatus, isStuck, isDeadlineExceeded, MAX_ATTEMPTS } from "./email-send-queue-rules";

// ── nextStatus — B6 ──

test("발송에 성공하면 sent다", () => {
    assert.equal(nextStatus("ok", 1), "sent");
});

test("규칙 미매칭·쿨다운 등은 skipped이며 재시도하지 않는다 (B6)", () => {
    // 실패가 아니므로 attempts를 다 써도 failed가 아니다
    assert.equal(nextStatus("skip", 1), "skipped");
    assert.equal(nextStatus("skip", MAX_ATTEMPTS), "skipped");
});

test("실패했고 시도가 남았으면 pending으로 돌려 재시도한다 (B6)", () => {
    assert.equal(nextStatus("error", 1), "pending");
    assert.equal(nextStatus("error", MAX_ATTEMPTS - 1), "pending");
});

test("실패했고 시도를 다 썼으면 failed로 확정한다 (B6)", () => {
    // 무한 재시도를 막는 경계 — 이 줄이 깨지면 실패 건이 큐를 영원히 돈다
    assert.equal(nextStatus("error", MAX_ATTEMPTS), "failed");
});

test("attempts가 상한을 넘어도 failed다", () => {
    assert.equal(nextStatus("error", MAX_ATTEMPTS + 5), "failed");
});

// ── isStuck — B7 ──

const T0 = new Date("2026-09-01T10:00:00Z");
const THRESHOLD = 15 * 60 * 1000;

test("임계 시간을 넘긴 processing 행은 stuck이다 (B7)", () => {
    const lockedAt = new Date(T0.getTime() - 16 * 60 * 1000);
    assert.equal(isStuck(lockedAt, T0, THRESHOLD), true);
});

test("아직 처리 중일 수 있는 행은 stuck이 아니다 (B7)", () => {
    // 워커 상한이 8분이므로 15분 미만은 정상 처리 중일 수 있다
    const lockedAt = new Date(T0.getTime() - 8 * 60 * 1000);
    assert.equal(isStuck(lockedAt, T0, THRESHOLD), false);
});

test("정확히 임계값이면 아직 stuck이 아니다", () => {
    const lockedAt = new Date(T0.getTime() - THRESHOLD);
    assert.equal(isStuck(lockedAt, T0, THRESHOLD), false);
});

test("lockedAt이 없으면 stuck이 아니다", () => {
    // processing이 아닌 행이 섞여 들어와도 오판하지 않는다
    assert.equal(isStuck(null, T0, THRESHOLD), false);
});

test("lockedAt이 미래여도 stuck이 아니다", () => {
    // 서버 시계가 어긋나도 멀쩡한 행을 회수하지 않는다
    const lockedAt = new Date(T0.getTime() + 60 * 1000);
    assert.equal(isStuck(lockedAt, T0, THRESHOLD), false);
});

// ── isDeadlineExceeded — B3 ──

test("예산 안이면 계속 처리한다 (B3)", () => {
    assert.equal(isDeadlineExceeded(1000, 1000 + 60_000, 480_000), false);
});

test("예산을 넘기면 다음 회차로 넘긴다 (B3)", () => {
    assert.equal(isDeadlineExceeded(1000, 1000 + 481_000, 480_000), true);
});

test("정확히 예산이면 넘긴 것으로 본다", () => {
    // 경계에서 한 배치 더 도는 것보다 일찍 끊는 쪽이 안전하다 (HTTP 타임아웃 회피)
    assert.equal(isDeadlineExceeded(1000, 1000 + 480_000, 480_000), true);
});
