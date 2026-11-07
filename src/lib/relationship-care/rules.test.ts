import assert from "node:assert/strict";
import { test } from "node:test";
import {
    applyAction,
    baseDraft,
    businessCardInput,
    careSettingsInput,
    compareCards,
    decideCard,
    DAY,
    nextDueAfterTouch,
    seasonOf,
    statusOf,
    upcomingAnniversary,
    welcomeDeadline,
    type CareState,
} from "./rules";

const now = new Date("2026-11-07T01:00:00Z"); // 서울 2026-11-07 10:00
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const later = (days: number) => new Date(now.getTime() + days * DAY);
const care = (over: Partial<CareState> = {}): CareState => ({
    tier: "b",
    cadenceDays: null,
    lastTouchAt: ago(10),
    nextDueAt: later(50),
    snoozedUntil: null,
    memoryNote: "",
    importantDates: [],
    unansweredCount: 0,
    ...over,
});

test("등급별 기본 주기와 개별 주기로 다음 점검일을 계산한다", () => {
    assert.equal(nextDueAfterTouch({ tier: "a", cadenceDays: null }, now).getTime(), later(30).getTime());
    assert.equal(nextDueAfterTouch({ tier: "d", cadenceDays: null }, now).getTime(), later(180).getTime());
    assert.equal(nextDueAfterTouch({ tier: "a", cadenceDays: 14 }, now).getTime(), later(14).getTime());
    assert.equal(welcomeDeadline(now).getTime(), now.getTime() + 48 * 3_600_000);
});

test("관계 상태: 첫 인사 전·기한 초과·임박·장기 미접촉·양호", () => {
    assert.equal(statusOf(care({ lastTouchAt: null, nextDueAt: now }), now), "welcome");
    assert.equal(statusOf(care({ lastTouchAt: ago(61), nextDueAt: ago(1) }), now), "overdue");
    assert.equal(statusOf(care({ nextDueAt: later(7) }), now), "soon");
    assert.equal(statusOf(care({ nextDueAt: later(8) }), now), "ok");
    // B등급 60일의 2배(120일)를 넘으면 장기 미접촉
    assert.equal(statusOf(care({ lastTouchAt: ago(121), nextDueAt: ago(61) }), now), "dormant");
});

test("명함 등록 직후 카드는 첫 인사로 바로 오른다", () => {
    const d = decideCard(care({ lastTouchAt: null, nextDueAt: now }), now);
    assert.deepEqual([d.show, d.reason, d.status], [true, "welcome", "welcome"]);
});

test("다음 주로 미룬 카드는 7일 동안 숨고, 기한이 멀면 카드가 없다", () => {
    const overdue = care({ lastTouchAt: ago(70), nextDueAt: ago(10) });
    const snoozed = { ...overdue, ...applyAction(overdue, "snooze", now) };
    assert.equal(decideCard(snoozed, now).show, false);
    assert.equal(decideCard(snoozed, later(6)).show, false);
    assert.equal(decideCard(snoozed, later(7.01)).show, true);
    assert.equal(decideCard(care(), now).show, false);
});

test("이번 주기 건너뛰기는 마지막 연락일을 바꾸지 않고 점검일만 한 주기 미룬다", () => {
    const overdue = care({ lastTouchAt: ago(70), nextDueAt: ago(10) });
    const next = applyAction(overdue, "skip", now);
    assert.equal(next.lastTouchAt, overdue.lastTouchAt);
    assert.equal(next.nextDueAt.getTime(), later(60).getTime());
});

test("기념일 3일 전부터 카드에 오르되 14일 안에 연락했으면 다시 내지 않는다", () => {
    const dates = [{ label: "생일", monthDay: "11-09" }];
    const d = decideCard(care({ lastTouchAt: ago(20), importantDates: dates }), now);
    assert.deepEqual([d.show, d.reason, d.anniversary?.inDays], [true, "anniversary", 2]);
    assert.equal(decideCard(care({ lastTouchAt: ago(5), importantDates: dates }), now).show, false);
    assert.equal(upcomingAnniversary([{ label: "창립일", monthDay: "01-02" }], new Date("2026-12-30T03:00:00Z"))?.inDays, 3);
});

test("최근 3일 안에 마케팅 메일을 받은 사람은 미루되 첫 인사는 미루지 않는다", () => {
    const overdue = care({ lastTouchAt: ago(70), nextDueAt: ago(1) });
    const d = decideCard(overdue, now, ago(1));
    assert.deepEqual([d.show, d.deferredByMarketing], [false, true]);
    assert.equal(decideCard(overdue, now, ago(4)).show, true);
    assert.equal(decideCard(care({ lastTouchAt: null, nextDueAt: now }), now, ago(1)).show, true);
});

test("연락 계기: 메모가 있으면 메모 후속, 연말·새해에는 시기 인사", () => {
    const overdue = { lastTouchAt: ago(70), nextDueAt: ago(1) };
    assert.equal(decideCard(care({ ...overdue, memoryNote: "일본 출장 예정" }), now).reason, "memory");
    assert.equal(decideCard(care(overdue), now).reason, "routine");
    assert.equal(seasonOf(new Date("2026-12-24T03:00:00Z")), "yearEnd");
    assert.equal(seasonOf(new Date("2026-12-31T16:00:00Z")), "newYear"); // 서울 1월 1일
    assert.equal(seasonOf(now), null);
});

test("장기 미접촉에 보낸 인사가 답장 없이 2회 쌓이면 등급을 한 단계 낮춘다", () => {
    const dormant = care({ tier: "b", lastTouchAt: ago(130), nextDueAt: ago(70) });
    const first = applyAction(dormant, "sent", now);
    assert.deepEqual([first.tier, first.unansweredCount], ["b", 1]);
    const again = applyAction({ ...dormant, unansweredCount: 1, lastTouchAt: ago(130) }, "sent", now);
    assert.deepEqual([again.tier, again.unansweredCount], ["c", 0]);
    assert.equal(again.nextDueAt.getTime(), later(90).getTime());
    assert.equal(applyAction({ ...dormant, unansweredCount: 1 }, "reply", now).unansweredCount, 0);
    assert.equal(applyAction({ ...dormant, tier: "d", unansweredCount: 1 }, "sent", now).tier, "d");
});

test("카드 순서: 기념일 → 첫 인사 → 기한 초과 → 장기 미접촉 → 기한 지난 첫 인사 → 임박", () => {
    const rows = [
        { id: "stale", status: "welcome" as const, nextDueAt: ago(5), reason: "welcome" as const, welcomeDeadline: ago(3) },
        { id: "soon", status: "soon" as const, nextDueAt: later(1), reason: "routine" as const },
        { id: "anniv", status: "ok" as const, nextDueAt: later(40), reason: "anniversary" as const },
        { id: "welcome", status: "welcome" as const, nextDueAt: now, reason: "welcome" as const, welcomeDeadline: later(1) },
        { id: "late2", status: "overdue" as const, nextDueAt: ago(1), reason: "routine" as const },
        { id: "late1", status: "overdue" as const, nextDueAt: ago(5), reason: "routine" as const },
        { id: "dormant", status: "dormant" as const, nextDueAt: ago(2), reason: "dormant" as const },
    ];
    assert.deepEqual(rows.sort(compareCards(now)).map((r) => r.id), ["anniv", "welcome", "late1", "late2", "dormant", "stale", "soon"]);
});

test("기본 초안은 이름·보낸 사람·만난 곳만 넣고 지어낸 사실이 없다", () => {
    const d = baseDraft({ contactName: "김민지", senderName: "박영업", reason: "welcome", metPlace: "스마트공장 엑스포" });
    assert.match(d.sms, /김민지님/);
    assert.match(d.sms, /스마트공장 엑스포에서 인사드린 박영업입니다/);
    assert.match(d.emailBody, /박영업 드림$/);
    const plain = baseDraft({ contactName: "이수", senderName: "박영업", reason: "welcome" });
    assert.doesNotMatch(plain.sms, /에서 인사드린/);
    assert.match(baseDraft({ contactName: "이수", senderName: "박영업", reason: "anniversary", anniversaryLabel: "생일" }).sms, /생일 진심으로 축하/);
    assert.match(baseDraft({ contactName: "이수", senderName: "박영업", reason: "season", season: "newYear" }).emailSubject, /새해/);
});

test("입력 검사: 등급·기념일 형식·명함 메일 소문자화", () => {
    assert.throws(() => careSettingsInput.parse({ workspaceId: 1, tier: "e" }));
    assert.throws(() => careSettingsInput.parse({ workspaceId: 1, tier: "a", importantDates: [{ label: "생일", monthDay: "13-01" }] }));
    assert.equal(careSettingsInput.parse({ workspaceId: 1, tier: "a", importantDates: [{ label: "생일", monthDay: "02-29" }] }).tier, "a");
    assert.equal(businessCardInput.parse({ workspaceId: 1, name: "김", tier: "c", email: "Kim@Ex.COM" }).email, "kim@ex.com");
});

test("개별 주기가 짧아도 연락 뒤 14일 안에는 카드를 다시 내지 않는다", () => {
    const short = care({ cadenceDays: 7, lastTouchAt: null, nextDueAt: now });
    const sent = { ...short, ...applyAction(short, "sent", now) };
    assert.equal(decideCard(sent, now).show, false);
    assert.equal(decideCard(sent, later(10)).show, false);
    assert.equal(decideCard(sent, later(14.01)).show, true);
});

test("장기 미접촉 인사 뒤 답장 없이 다음 주기에 또 보내면 등급을 낮추고, 답장 기록은 초기화한다", () => {
    const dormant = care({ tier: "b", lastTouchAt: ago(130), nextDueAt: ago(70) });
    const first = { ...dormant, ...applyAction(dormant, "sent", now) };
    assert.equal(first.unansweredCount, 1);
    // 60일 뒤 기한 초과(장기 미접촉 아님) 상태에서 다시 보냄
    const second = applyAction(first, "sent", later(61));
    assert.equal(statusOf(first, later(61)), "overdue");
    assert.deepEqual([second.tier, second.unansweredCount], ["c", 0]);
    const replied = { ...first, ...applyAction(first, "reply", later(10)) };
    assert.equal(applyAction(replied, "sent", later(80)).unansweredCount, 0);
});

test("개별 주기가 7일 이하여도 건너뛰기 뒤 카드가 빠졌다가 8일 뒤 돌아온다", () => {
    const short = care({ cadenceDays: 7, lastTouchAt: ago(30), nextDueAt: ago(23) });
    const skipped = { ...short, ...applyAction(short, "skip", now) };
    assert.equal(decideCard(skipped, now).show, false);
    assert.equal(decideCard(skipped, later(1.01)).show, true);
    assert.equal(skipped.nextDueAt.getTime(), later(8).getTime());
});

test("통화·만남 기록은 답장 받음과 같아 무응답 수를 0으로 되돌리고, 문자 기록은 센다", () => {
    const dormant = care({ tier: "b", lastTouchAt: ago(130), nextDueAt: ago(70), unansweredCount: 1 });
    const call = applyAction(dormant, "logged", now, "call");
    assert.deepEqual([call.tier, call.unansweredCount], ["b", 0]);
    assert.equal(call.lastTouchAt, now);
    const sms = applyAction(dormant, "logged", now, "sms");
    assert.deepEqual([sms.tier, sms.unansweredCount], ["c", 0]);
});

test("2월 29일 기념일은 평년에는 2월 28일에 뜬다", () => {
    const dates = [{ label: "생일", monthDay: "02-29" }];
    // 2027년(평년) 2월 26일 서울 → 2일 뒤 2/28에 잡힌다
    assert.equal(upcomingAnniversary(dates, new Date("2027-02-26T03:00:00Z"))?.inDays, 2);
    // 2028년(윤년) 2월 27일 → 2일 뒤 2/29
    assert.equal(upcomingAnniversary(dates, new Date("2028-02-27T03:00:00Z"))?.inDays, 2);
    assert.equal(upcomingAnniversary(dates, new Date("2028-02-25T03:00:00Z")), null);
});
