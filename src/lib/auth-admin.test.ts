import { test } from "node:test";
import assert from "node:assert";
import {
    checkTokenVersion,
    isTokenVersionAcceptable,
    hasMinRole,
} from "./auth-admin-rules";

// ── checkTokenVersion — B10 / B6 ──

test("토큰과 DB 버전이 같으면 통과한다 (B10)", () => {
    assert.equal(checkTokenVersion(0, 0), "ok");
});

test("버전이 올라간 뒤의 옛 토큰은 stale이다 (B10)", () => {
    assert.equal(checkTokenVersion(0, 1), "stale");
});

test("여러 번 강등된 뒤에도 옛 토큰은 stale이다 (B10)", () => {
    assert.equal(checkTokenVersion(1, 5), "stale");
});

test("0이 아닌 같은 버전끼리도 통과한다 (B10)", () => {
    assert.equal(checkTokenVersion(3, 3), "ok");
});

test("토큰 버전이 DB보다 커도 거부한다 — fail-closed (B10)", () => {
    // 롤백·복제 지연으로 앞선 값이 들어와도 통과시키지 않는다
    assert.equal(checkTokenVersion(5, 3), "stale");
});

test("tokenVersion이 없는 배포 전 토큰은 DB가 0이면 missing이다 (B6)", () => {
    assert.equal(checkTokenVersion(undefined, 0), "missing");
});

test("tokenVersion이 없어도 이미 강등된 멤버면 stale이다 (B6)", () => {
    // 이 한 줄이 "배포 직전 토큰은 영원히 무효화를 피한다"는 구멍을 닫는다
    assert.equal(checkTokenVersion(undefined, 1), "stale");
});

test("tokenVersion이 없고 DB가 여러 번 올라갔어도 stale이다 (B6)", () => {
    assert.equal(checkTokenVersion(undefined, 7), "stale");
});

// ── isTokenVersionAcceptable — 정책의 단일 지점 ──

test("ok는 통과시킨다", () => {
    assert.equal(isTokenVersionAcceptable("ok"), true);
});

test("stale은 거부한다", () => {
    assert.equal(isTokenVersionAcceptable("stale"), false);
});

test("배포 전 토큰(missing)은 현재 정책상 통과시킨다", () => {
    // 배포 후 30일이 지나면 이 입력 자체가 존재할 수 없다.
    // 정책을 뒤집을 때 고칠 곳은 여기 하나뿐이다.
    assert.equal(isTokenVersionAcceptable("missing"), true);
});

// ── hasMinRole — 게이트 경계 ──

test("member는 admin 게이트를 통과하지 못한다", () => {
    assert.equal(hasMinRole("member", "admin"), false);
});

test("admin은 admin 게이트를 통과한다", () => {
    assert.equal(hasMinRole("admin", "admin"), true);
});

test("owner는 admin 게이트를 통과한다", () => {
    assert.equal(hasMinRole("owner", "admin"), true);
});

test("admin은 owner 게이트를 통과하지 못한다", () => {
    // 조직 삭제·구독 해지가 여기 걸린다
    assert.equal(hasMinRole("admin", "owner"), false);
});

test("owner는 owner 게이트를 통과한다", () => {
    assert.equal(hasMinRole("owner", "owner"), true);
});

test("알 수 없는 role은 member 게이트도 통과하지 못한다", () => {
    // api-handler.ts의 `?? 0`(member로 강등)과 의도적으로 다르다 — fail-closed
    assert.equal(hasMinRole("guest", "member"), false);
});

test("빈 문자열 role도 거부한다", () => {
    assert.equal(hasMinRole("", "admin"), false);
});
