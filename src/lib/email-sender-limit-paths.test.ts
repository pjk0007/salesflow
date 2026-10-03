import { test } from "node:test";
import assert from "node:assert";
import {
    activeBlock,
    blocksRestOfBatch,
    describeLimitedSend,
    followupSenderOrder,
    isDeferralOnlyBatch,
    normalizeSenderAddress,
    pickSenderCandidates,
    restartedWarmupStartedOn,
    senderProfileChangeNeedsAdmin,
    senderProfileDeleteNeedsAdmin,
} from "./email-sender-limit-paths";
import { pickSender } from "./email-sender-pick";
import type { LegacyEmailConfig, ResolvedSender, SenderCandidate } from "./email-sender-pick";
import { DEFAULT_LIMIT_SETTINGS, linkSenderPool } from "./email-sender-limit-rules";
import { kstToDate } from "./kst";

// ── pickSenderCandidates — W1: 한도가 없으면 고르는 주소가 pickSender와 같다 ──

const profile = (id: number, isDefault = false): SenderCandidate => ({
    id,
    fromEmail: `p${id}@example.com`,
    fromName: `발신 ${id}`,
    isDefault,
});
/** 이 조직 주소 전부. 5가 기본, 7·8은 일반. 다른 조직·삭제된 id(99 등)는 여기 없다 */
const ORG = [profile(5, true), profile(7), profile(8)];
const LEGACY: LegacyEmailConfig = { fromEmail: "legacy@example.com", fromName: "레거시" };

/** 한도가 없을 때 claimSender가 실제로 보낼 주소: 후보 목록이면 첫 주소(묶음 순서), 아니면 그대로 */
function firstPick(r: SenderCandidate[] | ResolvedSender): number | null | string {
    if (Array.isArray(r)) return r.length > 0 ? r[0].id : "빈 후보";
    return r.profileId ?? r.fromEmail;
}
function pickSenderResult(preferredIds: ReadonlyArray<number | null | undefined>, candidates = ORG, config: LegacyEmailConfig | null = LEGACY) {
    const r = pickSender({ preferredIds, candidates, config });
    return r.profileId ?? r.fromEmail;
}

test("단일 주소 규칙은 예전 resolveSender([link.senderProfileId])와 같은 주소다 (W1)", () => {
    const pool = linkSenderPool({ senderProfileId: 7, senderProfileIds: null });
    assert.equal(firstPick(pickSenderCandidates(ORG, { mode: "pool", ids: pool, config: LEGACY })), pickSenderResult([7]));
    assert.equal(firstPick(pickSenderCandidates(ORG, { mode: "pool", ids: pool, config: LEGACY })), 7);
});

test("빈 묶음은 기본 주소로 — pickSender에 선호 id 없이 (W1)", () => {
    const r = pickSenderCandidates(ORG, { mode: "pool", ids: [], config: LEGACY });
    assert.equal(firstPick(r), pickSenderResult([]));
    assert.equal(firstPick(r), 5);
});

test("묶음 id가 전부 삭제됐거나 다른 조직 것이면 기본 주소다 — 묶음의 다른 주소로 새지 않는다 (W1)", () => {
    const r = pickSenderCandidates(ORG, { mode: "pool", ids: [99, 100], config: LEGACY });
    assert.equal(firstPick(r), pickSenderResult([99, 100]));
    assert.equal(firstPick(r), 5);
});

test("묶음은 순서를 지키고 null·중복·없는 id만 뺀다", () => {
    const r = pickSenderCandidates(ORG, { mode: "pool", ids: [8, null, 99, 7, 8, undefined], config: LEGACY });
    assert.ok(Array.isArray(r));
    assert.deepEqual(r.map((p) => p.id), [8, 7]);
});

test("기본 주소 없이 레거시 설정만 있는 조직은 예약 없이 레거시 발신자로 통과한다 (W1)", () => {
    const noDefault = [profile(7), profile(8)];
    for (const mode of ["pool", "fixed"] as const) {
        const r = pickSenderCandidates(noDefault, { mode, ids: [], config: LEGACY });
        assert.ok(!Array.isArray(r), `${mode}: 후보 목록이 아니라 발신자 그대로여야 한다`);
        assert.deepEqual(r, { fromEmail: "legacy@example.com", fromName: "레거시", profileId: null });
        assert.equal(firstPick(r), pickSenderResult([], noDefault));
    }
});

test("프로필도 레거시 설정도 없으면 주소 없는 발신자 그대로다 — 아무 프로필이나 고르지 않는다", () => {
    const r = pickSenderCandidates([profile(7)], { mode: "pool", ids: [], config: null });
    assert.deepEqual(r, { fromEmail: null, profileId: null });
});

test("fixed는 pickSender 순서의 첫 주소 하나만 본다 — [null, id]면 id (W1, W16)", () => {
    const r = pickSenderCandidates(ORG, { mode: "fixed", ids: [null, 8, 7], config: LEGACY });
    assert.ok(Array.isArray(r));
    assert.deepEqual(r.map((p) => p.id), [8]);
    assert.equal(firstPick(r), pickSenderResult([null, 8, 7]));
});

test("fixed의 선호 id가 모두 없으면 기본 주소 하나다", () => {
    const r = pickSenderCandidates(ORG, { mode: "fixed", ids: [99, null], config: LEGACY });
    assert.ok(Array.isArray(r));
    assert.deepEqual(r.map((p) => p.id), [5]);
    assert.equal(firstPick(r), pickSenderResult([99, null]));
});

test("pool은 fixed와 달리 묶음 전부를 후보로 준다 (가장 오래 쉰 주소는 rankPool이 고른다)", () => {
    const pool = pickSenderCandidates(ORG, { mode: "pool", ids: [8, 7], config: LEGACY });
    const fixed = pickSenderCandidates(ORG, { mode: "fixed", ids: [8, 7], config: LEGACY });
    assert.ok(Array.isArray(pool) && Array.isArray(fixed));
    assert.deepEqual(pool.map((p) => p.id), [8, 7]);
    assert.deepEqual(fixed.map((p) => p.id), [8]);
});

// ── followupSenderOrder — W16 ──

test("AI 후속은 첫 메일을 보낸 주소가 규칙 묶음보다 먼저다 (W16)", () => {
    assert.deepEqual(followupSenderOrder(7, { senderProfileId: 3, senderProfileIds: [3, 4] }), [7, 3, 4]);
});

test("묶음 칸이 없는 옛 규칙은 sender_profile_id 하나가 뒤에 붙는다", () => {
    assert.deepEqual(followupSenderOrder(7, { senderProfileId: 3, senderProfileIds: null }), [7, 3]);
});

test("구 로그(첫 메일 주소 null)는 null을 앞에 두어 pickSender가 건너뛰게 한다", () => {
    // null을 빼지 않는다 — 순서 배열 모양이 늘 같아야 호출부가 헷갈리지 않는다
    assert.deepEqual(followupSenderOrder(null, { senderProfileId: 3, senderProfileIds: [3] }), [null, 3]);
});

test("규칙이 없거나 묶음이 비면 첫 메일 주소만 남는다 (그다음은 기본 주소)", () => {
    assert.deepEqual(followupSenderOrder(7, null), [7]);
    assert.deepEqual(followupSenderOrder(7, undefined), [7]);
    assert.deepEqual(followupSenderOrder(7, { senderProfileId: null, senderProfileIds: [] }), [7]);
});

test("첫 메일 주소가 묶음에 있어도 순서만 앞설 뿐 결과가 같다", () => {
    // pickSender는 첫 유효 id를 고르므로 중복이 있어도 고르는 주소가 바뀌지 않는다
    assert.deepEqual(followupSenderOrder(4, { senderProfileId: 3, senderProfileIds: [3, 4] }), [4, 3, 4]);
});

// ── blocksRestOfBatch ──

test("하루 한도·정지·시간대 밖은 수동 발송의 남은 레코드도 바로 막는다", () => {
    assert.equal(blocksRestOfBatch("daily_limit"), true);
    assert.equal(blocksRestOfBatch("paused"), true);
    assert.equal(blocksRestOfBatch("outside_window"), true);
});

test("간격은 요청 중에 다시 열릴 수 있어 레코드마다 다시 본다", () => {
    assert.equal(blocksRestOfBatch("spacing"), false);
});

// ── describeLimitedSend ──

const RETRY = kstToDate("2026-10-03", 9);

test("한도 사유는 다시 보낼 수 있는 한국 시각을 함께 적는다", () => {
    assert.equal(
        describeLimitedSend("daily_limit", RETRY),
        "발신 프로필의 오늘 발송 한도를 다 써서 보내지 않았습니다 (10/3 09:00부터 보낼 수 있음).",
    );
    assert.match(describeLimitedSend("outside_window", RETRY), /발송 시간대가 아니라.*10\/3 09:00부터/);
    assert.match(describeLimitedSend("spacing", kstToDate("2026-10-02", 14, 10)), /간격.*10\/2 14:10부터/);
});

test("정지는 풀릴 때를 모르므로 시각을 적지 않는다", () => {
    const text = describeLimitedSend("paused", RETRY);
    assert.equal(text, "발신 프로필이 일시 정지되어 있어 보내지 않았습니다.");
    assert.doesNotMatch(text, /\d+\/\d+/);
});

test("같은 이유·같은 시각이면 문구가 같다 (화면이 한 줄로 묶는다)", () => {
    assert.equal(
        describeLimitedSend("daily_limit", kstToDate("2026-10-03", 9)),
        describeLimitedSend("daily_limit", new Date(RETRY.getTime())),
    );
});

// ── isDeferralOnlyBatch — 대기열 배치 사이 쉼 ──

test("배치가 전부 미룸이면 쉬지 않는다", () => {
    assert.equal(isDeferralOnlyBatch([true, true, true]), true);
});

test("발송·실패가 하나라도 있으면 쉰다 (NHN 호출 간격)", () => {
    assert.equal(isDeferralOnlyBatch([true, false]), false);
    assert.equal(isDeferralOnlyBatch([false]), false);
});

test("빈 배치는 미룸만 낸 배치가 아니다", () => {
    assert.equal(isDeferralOnlyBatch([]), false);
});

// ── 발신 프로필 API의 관리자 확인 (리뷰 SEC-2) ──

const NO_LIMIT = DEFAULT_LIMIT_SETTINGS;
const LIMITED = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 50 };
const WARMING = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 50, warmupEnabled: true, warmupStartedOn: "2026-09-02" };

test("한도가 걸린 주소와 같은 주소로 프로필을 더 만들면 관리자만 — 한도 없는 복제로 한도를 피해 가지 못하게", () => {
    const reason = senderProfileChangeNeedsAdmin({
        current: null,
        nextFromEmail: "  Sales@X.com ",
        others: [{ fromEmail: "sales@x.com", limits: LIMITED }],
    });
    assert.match(reason ?? "", /관리자/);
});

test("한도 없는 주소끼리는 예전처럼 누구나 만들고 바꾼다", () => {
    assert.equal(
        senderProfileChangeNeedsAdmin({
            current: null,
            nextFromEmail: "sales@x.com",
            others: [{ fromEmail: "sales@x.com", limits: NO_LIMIT }],
        }),
        null,
    );
    assert.equal(
        senderProfileChangeNeedsAdmin({
            current: { fromEmail: "a@x.com", limits: NO_LIMIT },
            nextFromEmail: "b@x.com",
            others: [{ fromEmail: "c@x.com", limits: LIMITED }],
        }),
        null,
    );
});

test("한도가 걸린 프로필의 주소를 바꾸는 것은 관리자만 — 이름만 고치거나 대소문자만 같으면 바꾼 게 아니다", () => {
    const current = { fromEmail: "sales@x.com", limits: LIMITED };
    assert.match(senderProfileChangeNeedsAdmin({ current, nextFromEmail: "new@cold.com", others: [] }) ?? "", /관리자/);
    assert.equal(senderProfileChangeNeedsAdmin({ current, nextFromEmail: "SALES@x.com ", others: [] }), null);
    assert.equal(senderProfileChangeNeedsAdmin({ current, nextFromEmail: undefined, others: [] }), null);
});

test("정지·한도가 걸린 프로필을 지우는 것은 관리자만", () => {
    assert.match(senderProfileDeleteNeedsAdmin({ ...DEFAULT_LIMIT_SETTINGS, isPaused: true }) ?? "", /관리자/);
    assert.match(senderProfileDeleteNeedsAdmin(LIMITED) ?? "", /관리자/);
    assert.equal(senderProfileDeleteNeedsAdmin(NO_LIMIT), null);
});

test("주소를 바꾸면 웜업을 오늘 0일째부터 다시 센다 — 이전 주소의 웜업 날수가 넘어가지 않게", () => {
    assert.equal(restartedWarmupStartedOn("sales@x.com", "new@cold.com", WARMING, "2026-10-02"), "2026-10-02");
    // 주소가 그대로거나 웜업이 꺼져 있으면 시작일을 건드리지 않는다
    assert.equal(restartedWarmupStartedOn("sales@x.com", " Sales@X.com", WARMING, "2026-10-02"), null);
    assert.equal(restartedWarmupStartedOn("sales@x.com", undefined, WARMING, "2026-10-02"), null);
    assert.equal(restartedWarmupStartedOn("sales@x.com", "new@cold.com", LIMITED, "2026-10-02"), null);
});

test("normalizeSenderAddress는 앞뒤 공백을 빼고 소문자로 맞춘다", () => {
    assert.equal(normalizeSenderAddress("  Sales@X.COM "), "sales@x.com");
});

// ── activeBlock — 반복 대기열의 회차 안 조직별 막힘 기록 (리뷰 concurrency F2) ──

test("activeBlock: 막힌 시각 전이면 그 시각, 지났으면 null이고 기록을 지운다", () => {
    const memo = new Map<string, Date>([["org-a", kstToDate("2026-10-03", 9)]]);
    assert.equal(activeBlock(memo, "org-a", kstToDate("2026-10-02", 10))?.toISOString(), kstToDate("2026-10-03", 9).toISOString());
    assert.equal(activeBlock(memo, "org-b", kstToDate("2026-10-02", 10)), null);
    assert.equal(activeBlock(memo, "org-a", kstToDate("2026-10-03", 9)), null);
    assert.equal(memo.has("org-a"), false);
});
