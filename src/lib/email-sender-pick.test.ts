import { test } from "node:test";
import assert from "node:assert";
import { pickSender, pickSignature } from "./email-sender-pick";
import type { SenderCandidate, SignatureCandidate, LegacyEmailConfig } from "./email-sender-pick";

const P1: SenderCandidate = { id: 1, fromEmail: "sales@a.com", fromName: "A팀", isDefault: false };
const P_DEF: SenderCandidate = { id: 9, fromEmail: "cs@b.com", fromName: "고객센터", isDefault: true };

const S1: SignatureCandidate = { id: 1, signature: "SIG_ONE", isDefault: false };
const S_DEF: SignatureCandidate = { id: 9, signature: "SIG_DEFAULT", isDefault: true };

const CFG: LegacyEmailConfig = {
    fromEmail: "legacy@c.com",
    fromName: "레거시",
    signatureEnabled: true,
    signature: "SIG_LEGACY",
};

// ── pickSender ──

test("명시 profileId가 유효하면 그 프로필을 반환한다 (B1)", () => {
    const r = pickSender({ preferredIds: [1], candidates: [P1, P_DEF], config: null });
    assert.equal(r.fromEmail, "sales@a.com");
    assert.equal(r.profileId, 1);
});

test("명시 profileId는 기본 프로필을 이긴다 (B1)", () => {
    const r = pickSender({ preferredIds: [1], candidates: [P1, P_DEF], config: null });
    assert.notEqual(r.fromEmail, "cs@b.com");
});

test("명시값이 없으면 기본 프로필로 fallback한다 (B2)", () => {
    const r = pickSender({ preferredIds: [], candidates: [P1, P_DEF], config: null });
    assert.equal(r.profileId, 9);
});

test("preferredIds의 null/undefined 원소는 무시한다 (B2/B14)", () => {
    // 구 로그의 senderProfileId는 null이다 — 에러 없이 기본값으로 흘러야 한다
    const r = pickSender({ preferredIds: [null, undefined], candidates: [P1, P_DEF], config: null });
    assert.equal(r.profileId, 9);
});

test("후보에 없는 id(삭제됐거나 타 org)는 건너뛰고 기본으로 간다 (B6/B16)", () => {
    const r = pickSender({ preferredIds: [1], candidates: [P_DEF], config: null });
    assert.equal(r.profileId, 9);
});

test("1순위가 비면 2순위 후보를 쓴다 (B12)", () => {
    const r = pickSender({ preferredIds: [undefined, 1], candidates: [P1, P_DEF], config: null });
    assert.equal(r.profileId, 1);
});

test("1순위가 죽어도 2순위를 보고, 기본으로 바로 떨어지지 않는다 (B16)", () => {
    const r = pickSender({ preferredIds: [999, 1], candidates: [P1, P_DEF], config: null });
    assert.equal(r.profileId, 1);
});

test("프로필이 없으면 레거시 config로 fallback하고 profileId는 null이다 (B3)", () => {
    const r = pickSender({ preferredIds: [], candidates: [], config: CFG });
    assert.equal(r.fromEmail, "legacy@c.com");
    assert.equal(r.fromName, "레거시");
    // 레거시에는 대응하는 프로필 행이 없다 — 요청된 id를 여기 넣으면 후속이 죽은 id를 상속한다
    assert.equal(r.profileId, null);
});

test("프로필도 config도 없으면 fromEmail은 null이다 (B3)", () => {
    const r = pickSender({ preferredIds: [], candidates: [], config: null });
    assert.equal(r.fromEmail, null);
    assert.equal(r.profileId, null);
});

test("fromEmail이 빈 config는 미설정과 같다 (B3)", () => {
    const r = pickSender({ preferredIds: [], candidates: [], config: { fromEmail: null } });
    assert.equal(r.fromEmail, null);
});

test("명시값이 레거시 config보다 우선한다", () => {
    const r = pickSender({ preferredIds: [1], candidates: [P1], config: CFG });
    assert.equal(r.profileId, 1);
});

test("기본 프로필이 레거시 config보다 우선한다 (B3)", () => {
    const r = pickSender({ preferredIds: [], candidates: [P_DEF], config: CFG });
    assert.equal(r.profileId, 9);
});

test("기본 프로필이 없으면 임의 프로필을 골라 쓰지 않는다", () => {
    // 서버 발송에서 아무 프로필이나 고르는 건 조용한 오배송이다 (UI의 profiles[0] fallback과 다름)
    const r = pickSender({ preferredIds: [], candidates: [P1], config: null });
    assert.equal(r.fromEmail, null);
});

// ── pickSignature ──

test("signatureId가 null이면 기본 서명과 레거시 둘 다 붙지 않는다 (B4)", () => {
    // 명시적 "서명 없음" — if (!signatureId) 로 짜면 이 테스트가 깨진다
    const r = pickSignature({ requestedId: null, candidates: [S1, S_DEF], config: CFG });
    assert.equal(r, null);
});

test("signatureId가 undefined면 기본 서명으로 fallback한다 (B5)", () => {
    const r = pickSignature({ requestedId: undefined, candidates: [S1, S_DEF], config: null });
    assert.equal(r, "SIG_DEFAULT");
});

test("기본 서명이 없으면 레거시 config 서명을 쓴다 (B5)", () => {
    const r = pickSignature({ requestedId: undefined, candidates: [], config: CFG });
    assert.equal(r, "SIG_LEGACY");
});

test("signatureEnabled가 false면 config 서명을 쓰지 않는다 (B5)", () => {
    const r = pickSignature({
        requestedId: undefined,
        candidates: [],
        config: { signatureEnabled: false, signature: "X" },
    });
    assert.equal(r, null);
});

test("config.signature가 비어있으면 null이다 (B5)", () => {
    const r = pickSignature({
        requestedId: undefined,
        candidates: [],
        config: { signatureEnabled: true, signature: null },
    });
    assert.equal(r, null);
});

test("명시 signatureId가 유효하면 그 서명을 쓴다", () => {
    const r = pickSignature({ requestedId: 1, candidates: [S1, S_DEF], config: null });
    assert.equal(r, "SIG_ONE");
});

test("명시 signatureId가 삭제됐으면 기본 서명으로 fallback한다", () => {
    // 서명은 발신 주소와 달리 fallback해도 오배송이 아니다
    const r = pickSignature({ requestedId: 1, candidates: [S_DEF], config: null });
    assert.equal(r, "SIG_DEFAULT");
});

test("signatureId가 0이면 null과 다른 경로로 간다 (falsy 함정)", () => {
    // Number(null) === 0 — 중간에서 Number() 변환하면 "서명 없음"이 기본 서명으로 바뀐다
    const r = pickSignature({ requestedId: 0, candidates: [S1, S_DEF], config: null });
    assert.equal(r, "SIG_DEFAULT");
});

test("후보도 config도 없으면 null이다 (B5)", () => {
    const r = pickSignature({ requestedId: undefined, candidates: [], config: null });
    assert.equal(r, null);
});
