import { test } from "node:test";
import assert from "node:assert";
import {
    angleOf,
    buildAlertMessage,
    buildUnsubscribeIndex,
    chatTextToHtml,
    contactKindOf,
    contactSummaryOf,
    decideAlert,
    deadlineText,
    evaluateSend,
    evaluateSendWithFallback,
    humanClickFallbackSession,
    isFunnelRecordEvent,
    isHumanClick,
    isLevelUpgrade,
    isRecordInFunnel,
    isSubmitSignal,
    isUnsubscribedBy,
    listTypeOf,
    nextAlertTime,
    normalizeEmail,
    pathOf,
    pickChosenSession,
    prefersHtml,
    recheckSkipReason,
    renderDeepAlertPreviewErrorHtml,
    renderDeepAlertPreviewHtml,
    resolveAlertConfig,
    rotateStart,
    summarizeVisitorClicks,
    EMAIL_TRIM_CHARS,
    MESSAGE_FOOTER,
    MESSAGE_MAX_CHARS,
    MESSAGE_TRUNCATION_NOTE,
    type AlertEvidence,
    type EventInput,
    type JourneyVerdict,
    type SendJourneyInput,
    type SessionInput,
} from "./deep-visitor-alert-rules";

// ── 고정 자료: 디하(워크스페이스 8, 자기 사이트 1)에 콜드메일 후속 1차가 나간 레코드 ──
// 2026-10-01은 목요일이다

const OWN_SITE_ID = 1; // designer-hire.com
const SISTER_SITE_ID = 3; // 픽셀앤로직 (메일 서명 링크)
const SESSION_ID = 3150442;
const VISITOR_ID = 48213;
const CLICK_ID = "clk_V1StGXR8_Z5jdHi6BmyTq";

const SENT = new Date("2026-10-01T10:00:00+09:00");
const CLICK_AT = new Date("2026-10-01T10:06:00+09:00");
const SESSION_START = new Date("2026-10-01T10:06:04+09:00");
const NOW = new Date("2026-10-01T12:00:00+09:00");

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

function ownSession(over: Partial<SessionInput> = {}): SessionInput {
    const startedAt = over.startedAt ?? SESSION_START;
    const duration = over.duration ?? 175;
    return {
        id: SESSION_ID,
        siteId: OWN_SITE_ID,
        visitorId: VISITOR_ID,
        startedAt,
        endedAt: plus(startedAt, duration * SEC),
        duration,
        pageCount: 1,
        clickId: CLICK_ID,
        ...over,
    };
}

/** 고른 세션 시작 기준 offsetSec초 뒤의 이벤트 */
function ev(eventType: string, eventName: string | null, offsetSec: number, over: Partial<EventInput> = {}): EventInput {
    return {
        sessionId: SESSION_ID,
        eventType,
        eventName,
        pageUrl: "https://designer-hire.com/",
        pageTitle: null,
        occurredAt: plus(SESSION_START, offsetSec * SEC),
        properties: null,
        ...over,
    };
}
const pv = (path: string, offsetSec: number, over: Partial<EventInput> = {}) =>
    ev("PAGE_VIEW", null, offsetSec, { pageUrl: `https://designer-hire.com${path}`, ...over });
const sv = (name: string, offsetSec: number) => ev("SECTION_VIEW", name, offsetSec, { properties: { dwell_ms: 4200 } });
const click = (name: string, offsetSec: number) => ev("CLICK", name, offsetSec);
const custom = (name: string, offsetSec: number) => ev("CUSTOM", name, offsetSec);

interface InputOpts {
    session?: Partial<SessionInput>;
    events?: EventInput[];
    clickAt?: Date;
    /** 같은 방문자의 다른 자기 사이트 세션 */
    others?: SessionInput[];
    /** foundSessions를 통째로 바꿀 때 */
    found?: SessionInput[];
    extra?: Partial<SendJourneyInput>;
}

function makeInput(opts: InputOpts = {}): SendJourneyInput {
    const s = ownSession(opts.session);
    return {
        sendLogId: 1583342,
        recordId: 772051,
        sentAt: SENT,
        clicks: [{ clickId: CLICK_ID, clickedAt: opts.clickAt ?? CLICK_AT }],
        foundSessions: opts.found ?? [s],
        ownSiteId: OWN_SITE_ID,
        visitorSessions: [s, ...(opts.others ?? [])],
        visitorEvents: opts.events ?? [],
        distinctClickedRecordsForVisitor: 1,
        alreadyInFunnel: false,
        unsubscribed: false,
        ...opts.extra,
    };
}

function judge(input: SendJourneyInput, now: Date = NOW) {
    const v = evaluateSend(input, now);
    return { v, d: decideAlert(input, v, now) };
}

/** 깊이 들어온 사람의 기본 모습: 홈 → 사례 영역 → 포트폴리오 */
const DEEP_EVENTS = [pv("/", 0), sv("hero", 10), sv("trust-cases", 40), pv("/portfolio/", 60)];

// ── 작은 도우미 ──

test("pathOf는 주소 앞부분·쿼리·해시를 떼고, 비면 / 이다", () => {
    assert.equal(pathOf("https://designer-hire.com/portfolio/?utm_source=sendb#top"), "/portfolio/");
    assert.equal(pathOf("https://designer-hire.com"), "/");
    assert.equal(pathOf("https://designer-hire.com?sendb_cid=clk_x"), "/");
    assert.equal(pathOf("HTTPS://Designer-Hire.com/Pricing"), "/Pricing");
    assert.equal(pathOf("/signup/email/"), "/signup/email/");
    assert.equal(pathOf(null), "");
    assert.equal(pathOf(""), "");
});

test("listTypeOf는 build_journey의 list_type과 같다", () => {
    assert.equal(listTypeOf("채용공고 9월 수집"), "채용공고 수집");
    assert.equal(listTypeOf("T2 디자이너 구인"), "채용공고 수집");
    assert.equal(listTypeOf("도메인-제조업"), "채용공고 수집");
    assert.equal(listTypeOf("(신규) 10월"), "채용공고 수집");
    assert.equal(listTypeOf("콜-백오피스 1차"), "구매 명단");
    assert.equal(listTypeOf("9월 콜드메일 2차"), "구매 명단");
    assert.equal(listTypeOf("일반 DB"), "구매 명단");
    assert.equal(listTypeOf("화책 2026"), "화장품 책임판매업");
    assert.equal(listTypeOf("기업 CRM"), "기타");
    assert.equal(listTypeOf(null), "기타");
});

// ── 사람 클릭 — B1 ──

test("클릭이 발송 120초 뒤면 기계, 121초면 사람 (B1)", () => {
    assert.equal(isHumanClick(SENT, plus(SENT, 120 * SEC)), false);
    assert.equal(isHumanClick(SENT, plus(SENT, 121 * SEC)), true);

    const opts = (clickAt: Date): InputOpts => ({
        clickAt,
        session: { startedAt: plus(clickAt, 3 * SEC), pageCount: 2 },
        events: [sv("hero", 5)],
    });
    const at120 = judge(makeInput(opts(plus(SENT, 120 * SEC))));
    assert.equal(at120.v.hasHumanClick, false);
    assert.equal(at120.v.machine, true);
    assert.equal(at120.v.machineReason, "early_only");
    assert.equal(at120.d.reason, "machine");

    const at121 = judge(makeInput(opts(plus(SENT, 121 * SEC))));
    assert.equal(at121.v.hasHumanClick, true);
    assert.equal(at121.v.firstHumanClickAt?.getTime(), plus(SENT, 121 * SEC).getTime());
    assert.equal(at121.v.machine, false);
});

test("start는 그 발송의 모든 클릭 중 가장 이른 것이다 (기계 클릭 포함)", () => {
    const input = makeInput({
        extra: {
            clicks: [
                { clickId: CLICK_ID, clickedAt: CLICK_AT },
                { clickId: "clk_aaaaaaaaaaaaaaaaaaaaa", clickedAt: plus(SENT, 20 * SEC) },
            ],
        },
    });
    const v = evaluateSend(input, NOW);
    assert.equal(v.start?.getTime(), plus(SENT, 20 * SEC).getTime());
    assert.equal(v.firstHumanClickAt?.getTime(), CLICK_AT.getTime());
});

// ── 2분 안 클릭만 — B2 ──

test("2분 안 클릭만 있고 2쪽·영역 1개·클릭 0이면 기계, 3쪽이면 사람 (B2)", () => {
    const early = plus(SENT, 40 * SEC);
    const base = (pageCount: number): InputOpts => ({
        clickAt: early,
        session: { startedAt: plus(early, 2 * SEC), pageCount, duration: 25 },
        events: [pv("/", 0), sv("hero", 3), pv("/consulting/", 20)],
    });
    const two = judge(makeInput(base(2)));
    assert.equal(two.v.machine, true);
    assert.equal(two.v.machineReason, "early_only");
    assert.equal(two.v.deepestStage, 0);
    // 기계로 보면 단계 표시는 모두 꺼진다 (원본과 같다)
    assert.equal(two.v.action, false);
    assert.deepEqual(two.v.actionNames, []);

    const three = judge(makeInput(base(3)));
    assert.equal(three.v.machine, false);
    assert.equal(three.v.deepestStage, 6);
});

test("2분 안 클릭이라도 영역 2개 이상이거나 무엇이든 누르면 사람 (B2)", () => {
    const early = plus(SENT, 40 * SEC);
    const session = { startedAt: plus(early, 2 * SEC), pageCount: 1, duration: 25 };
    const sections = judge(makeInput({ clickAt: early, session, events: [sv("hero", 3), sv("trust-logos", 6)] }));
    assert.equal(sections.v.machine, false);
    const clicked = judge(makeInput({ clickAt: early, session, events: [click("nav-insight", 8)] }));
    assert.equal(clicked.v.machine, false);
});

// ── 약한 방문 — B3 ──

test("약한 방문(2초·1쪽·영역 0·클릭 0·재방문 없음)은 기계 (B3)", () => {
    const r = judge(makeInput({ session: { duration: 2, pageCount: 1 }, events: [pv("/", 0)] }));
    assert.equal(r.v.hasHumanClick, true);
    assert.equal(r.v.machine, true);
    assert.equal(r.v.machineReason, "weak");
    assert.equal(r.d.reason, "machine");
});

test("약한 첫 방문이라도 30분 뒤 다시 와서 한 쪽 이상 보면 사람이다 (B3)", () => {
    const back = ownSession({ id: SESSION_ID + 77, startedAt: plus(SESSION_START, 3 * HOUR), pageCount: 1 });
    const r = judge(makeInput({ session: { duration: 2, pageCount: 1 }, others: [back] }), plus(SESSION_START, 5 * HOUR));
    assert.equal(r.v.revisit, true);
    assert.equal(r.v.machine, false);
    assert.equal(r.v.pages, 2);
    assert.equal(r.v.browsed, true);
});

test("30분 안에 다시 온 세션·0쪽 세션은 재방문이 아니다", () => {
    const soon = ownSession({ id: SESSION_ID + 1, startedAt: plus(SESSION_START, 20 * MIN), pageCount: 3 });
    const empty = ownSession({ id: SESSION_ID + 2, startedAt: plus(SESSION_START, 2 * HOUR), pageCount: 0 });
    const v = evaluateSend(makeInput({ others: [soon, empty] }), plus(SESSION_START, 5 * HOUR));
    assert.equal(v.revisit, false);
    assert.equal(v.pages, 4);
});

// ── 검사기 — B4 ──

test("60초 안 두 사이트 + 둘러보지 않음 → 검사기 (B4)", () => {
    const own = ownSession({ duration: 8, pageCount: 1 });
    const sister = ownSession({
        id: 7781230,
        siteId: SISTER_SITE_ID,
        visitorId: 99120,
        startedAt: plus(SESSION_START, 30 * SEC),
    });
    const r = judge(makeInput({ session: { duration: 8 }, found: [own, sister], events: [pv("/", 0), sv("hero", 2)] }));
    assert.equal(r.v.machine, true);
    assert.equal(r.v.machineReason, "scanner");
    assert.equal(r.d.reason, "machine");
});

test("두 사이트가 61초 넘게 벌어졌거나 2쪽 이상 보면 검사기가 아니다 (B4)", () => {
    const own = ownSession({ duration: 8, pageCount: 1 });
    const late = ownSession({ id: 7781230, siteId: SISTER_SITE_ID, visitorId: 99120, startedAt: plus(SESSION_START, 61 * SEC) });
    assert.equal(evaluateSend(makeInput({ session: { duration: 8 }, found: [own, late] }), NOW).machine, false);

    const browsedOwn = ownSession({ duration: 8, pageCount: 2 });
    const near = ownSession({ id: 7781230, siteId: SISTER_SITE_ID, visitorId: 99120, startedAt: plus(SESSION_START, 10 * SEC) });
    const v = evaluateSend(makeInput({ session: { duration: 8, pageCount: 2 }, found: [browsedOwn, near] }), NOW);
    assert.equal(v.machine, false);
});

// ── 자매 사이트만 — B5 ──

test("found에 자기 사이트가 없으면 자매 사이트만 → 알림 없음 (B5)", () => {
    const sister = ownSession({ id: 7781230, siteId: SISTER_SITE_ID, visitorId: 99120 });
    const r = judge(makeInput({ found: [sister], events: DEEP_EVENTS }));
    assert.equal(r.v.sisterSiteOnly, true);
    assert.equal(r.v.chosenSession, null);
    assert.equal(r.d.alert, false);
    assert.equal(r.d.reason, "sister_site_only");
});

test("세션을 하나도 못 찾으면 no_session", () => {
    const r = judge(makeInput({ found: [] }));
    assert.equal(r.v.sisterSiteOnly, false);
    assert.equal(r.v.deepestStage, 0);
    assert.equal(r.d.reason, "no_session");
});

test("자기 사이트가 없는 워크스페이스는 찾은 세션 전부를 자기 사이트로 본다", () => {
    const sister = ownSession({ siteId: SISTER_SITE_ID });
    const v = evaluateSend(makeInput({ found: [sister], events: DEEP_EVENTS, extra: { ownSiteId: null } }), NOW);
    assert.equal(v.sisterSiteOnly, false);
    assert.equal(v.chosenSession?.id, SESSION_ID);
});

test("고른 세션은 자기 사이트 세션 중 가장 이른 것이다 (자매 사이트가 더 일러도)", () => {
    const sisterFirst = ownSession({ id: 7781230, siteId: SISTER_SITE_ID, visitorId: 99120, startedAt: plus(CLICK_AT, 1 * SEC) });
    const ownLater = ownSession({ id: SESSION_ID + 5, startedAt: plus(SESSION_START, 2 * HOUR) });
    const v = evaluateSend(makeInput({ found: [ownLater, sisterFirst, ownSession()] }), NOW);
    assert.equal(v.chosenSession?.id, SESSION_ID);
});

// ── 기존 방문자 — B6·B7 ──

// 메일 전 방문은 메일 click_id가 없는 세션이다 (직접 들어옴)
test("첫 클릭 1분 전보다 이른 자기 사이트 세션 3개 → 기존 방문자 (B6)", () => {
    const before = [3, 2, 1].map((d, i) => ownSession({ id: 3000000 + i, startedAt: plus(CLICK_AT, -d * DAY), clickId: null }));
    const r = judge(makeInput({ events: DEEP_EVENTS, others: before }));
    assert.equal(r.v.existingVisitor, true);
    assert.equal(r.d.reason, "existing_visitor");
});

test("이른 세션 2개, 또는 정확히 1분 전 세션은 기존 방문자로 세지 않는다 (B6)", () => {
    const two = [2, 1].map((d, i) => ownSession({ id: 3000000 + i, startedAt: plus(CLICK_AT, -d * DAY), clickId: null }));
    const exactlyOneMinute = ownSession({ id: 3000009, startedAt: plus(CLICK_AT, -1 * MIN), clickId: null });
    const r = judge(makeInput({ events: DEEP_EVENTS, others: [...two, exactlyOneMinute] }));
    assert.equal(r.v.existingVisitor, false);
    assert.equal(r.d.alert, true);
});

test("다른 방문자의 세션은 기존 방문 수에 넣지 않는다", () => {
    const strangers = [3, 2, 1].map((d, i) =>
        ownSession({ id: 3000000 + i, visitorId: 50000 + i, startedAt: plus(CLICK_AT, -d * DAY), clickId: null })
    );
    assert.equal(evaluateSend(makeInput({ others: strangers }), NOW).existingVisitor, false);
});

test("한 방문자가 서로 다른 레코드 3개 → 기존 방문자, 2개는 아님 (B7)", () => {
    const three = judge(makeInput({ events: DEEP_EVENTS, extra: { distinctClickedRecordsForVisitor: 3 } }));
    assert.equal(three.d.reason, "existing_visitor");
    const two = judge(makeInput({ events: DEEP_EVENTS, extra: { distinctClickedRecordsForVisitor: 2 } }));
    assert.equal(two.d.reason, "ok");
});

// 9/20 1통째 메일을 누른 뒤 세 번 다시 온 사람 (tracker.js가 sendb_cid를 30일 두어 세션마다 1통째 click_id가 붙는다)
const FIRST_MAIL_CID = "clk_FirstMail_000000000a";
const priorFirstMailSessions = (clickId: string | null = FIRST_MAIL_CID) =>
    ["2026-09-20T11:00:00+09:00", "2026-09-21T15:30:00+09:00", "2026-09-23T10:10:00+09:00"].map((at, i) =>
        ownSession({ id: 3100000 + i, startedAt: new Date(at), pageCount: 3, clickId })
    );
const SIGNUP_EVENTS = [pv("/", 0), sv("trust-cases", 20), pv("/signup/", 40)];

test("같은 레코드의 앞선 메일로 온 세션은 기존 방문 수에 넣지 않는다 → 후속 메일에서 신청 시작하면 intent (B6·B16)", () => {
    const others = priorFirstMailSessions();
    // 이 레코드가 받은 메일의 click_id를 모르면(예전 동작) 1통째 메일 방문 3번이 "메일 전 방문"으로 잡힌다
    const before = judge(makeInput({ events: SIGNUP_EVENTS, others }));
    assert.equal(before.v.signupStart, true);
    assert.equal(before.v.existingVisitor, true);
    assert.equal(before.d.reason, "existing_visitor");

    const r = judge(makeInput({ events: SIGNUP_EVENTS, others, extra: { sameRecordClickIds: [FIRST_MAIL_CID] } }));
    assert.equal(r.v.existingVisitor, false);
    assert.equal(r.v.deepestStage, 7);
    assert.deepEqual(r.d, { alert: true, reason: "ok", level: "intent", angle: "A" });
    // 1통째 방문으로 이미 deep 알림을 받은 레코드도 intent로 올라간다
    assert.equal(isLevelUpgrade(["deep"], r.d.level ?? "deep"), true);
});

test("다른 레코드 메일의 click_id나 click_id 없는 이른 세션은 그대로 기존 방문으로 센다 (B6)", () => {
    for (const clickId of ["clk_OtherRecord_00000000b", null]) {
        const r = judge(
            makeInput({
                events: SIGNUP_EVENTS,
                others: priorFirstMailSessions(clickId),
                extra: { sameRecordClickIds: [FIRST_MAIL_CID] },
            })
        );
        assert.equal(r.d.reason, "existing_visitor", String(clickId));
    }
});

test("summarizeVisitorClicks: 방문자별 서로 다른 레코드 수와 레코드별 click_id (B6·B7)", () => {
    const summary = summarizeVisitorClicks([
        { visitorId: VISITOR_ID, clickId: FIRST_MAIL_CID, recordId: 772051 },
        { visitorId: VISITOR_ID, clickId: CLICK_ID, recordId: 772051 },
        { visitorId: VISITOR_ID, clickId: CLICK_ID, recordId: 772051 },
        { visitorId: VISITOR_ID, clickId: "clk_OtherRecord_00000000b", recordId: 880001 },
        { visitorId: 50001, clickId: "clk_Stranger_000000000000", recordId: 772051 },
    ]);
    assert.equal(summary.distinctRecords(VISITOR_ID), 2);
    assert.equal(summary.distinctRecords(50001), 1);
    assert.equal(summary.distinctRecords(99999), 0);
    assert.deepEqual(summary.clickIdsFor(VISITOR_ID, 772051).sort(), [CLICK_ID, FIRST_MAIL_CID].sort());
    assert.deepEqual(summary.clickIdsFor(VISITOR_ID, 880001), ["clk_OtherRecord_00000000b"]);
    assert.deepEqual(summary.clickIdsFor(50001, 880001), []);
});

// ── 사람 클릭 세션으로 다시 판정 — B21 ──

const SCANNER_CID = "clk_Scanner_0000000000000";
const HUMAN_CID = "clk_Human_000000000000000";
const SCANNER_CLICK = plus(SENT, 1 * SEC);
const HUMAN_CLICK = plus(SENT, 3 * HOUR);
const scannerSession = ownSession({
    id: 4000001,
    visitorId: 70001,
    startedAt: plus(SCANNER_CLICK, 1 * SEC),
    duration: 1,
    pageCount: 1,
    clickId: SCANNER_CID,
});
const humanSession = ownSession({
    id: 4000002,
    visitorId: 70002,
    startedAt: plus(HUMAN_CLICK, 2 * SEC),
    duration: 175,
    pageCount: 3,
    clickId: HUMAN_CID,
});
/** 사람 세션 시작 기준 offsetSec초 뒤 이벤트 */
const humanEv = (e: EventInput, offsetSec: number): EventInput => ({
    ...e,
    sessionId: humanSession.id,
    occurredAt: plus(humanSession.startedAt, offsetSec * SEC),
});
const HUMAN_EVENTS = [humanEv(pv("/", 0), 0), humanEv(sv("trust-cases", 0), 40), humanEv(pv("/portfolio/", 0), 60)];
const AFTER_HUMAN = plus(HUMAN_CLICK, 2 * HOUR);

/** 회사 메일: 보안 장비가 발송 1초 뒤 링크를 열고(V1), 사람이 3시간 뒤 같은 메일을 자기 브라우저(V2)로 눌렀다 */
function scannerThenHuman(): { base: SendJourneyInput; forSession: (s: SessionInput) => SendJourneyInput } {
    const base: SendJourneyInput = {
        ...makeInput(),
        clicks: [
            { clickId: SCANNER_CID, clickedAt: SCANNER_CLICK },
            { clickId: HUMAN_CID, clickedAt: HUMAN_CLICK },
        ],
        foundSessions: [humanSession, scannerSession],
        visitorSessions: [scannerSession],
        visitorEvents: [],
    };
    const forSession = (s: SessionInput): SendJourneyInput =>
        s.visitorId === humanSession.visitorId
            ? { ...base, visitorSessions: [humanSession], visitorEvents: HUMAN_EVENTS }
            : base;
    return { base, forSession };
}

test("보안 장비가 먼저 연 약한 세션 뒤 사람 클릭 세션이 깊이 봤으면 그 세션으로 다시 판정해 알린다 (B21)", () => {
    const { base, forSession } = scannerThenHuman();
    // 원본 규칙(가장 이른 세션)만 보면 장비 세션이 골라져 기계다
    const plain = judge(base, AFTER_HUMAN);
    assert.equal(plain.v.chosenSession?.id, scannerSession.id);
    assert.equal(plain.v.machineReason, "weak");
    assert.equal(plain.d.reason, "machine");

    const r = evaluateSendWithFallback(base, AFTER_HUMAN, forSession);
    assert.equal(r.usedFallback, true);
    assert.equal(r.input.chosenSessionId, humanSession.id);
    assert.equal(r.verdict.chosenSession?.id, humanSession.id);
    assert.equal(r.verdict.machine, false);
    assert.equal(r.verdict.sawCases, true);
    // 판정 기준 시각은 그대로 그 발송의 첫 클릭이다
    assert.equal(r.verdict.start?.getTime(), SCANNER_CLICK.getTime());
    assert.equal(r.verdict.firstHumanClickAt?.getTime(), HUMAN_CLICK.getTime());
    assert.deepEqual(decideAlert(r.input, r.verdict, AFTER_HUMAN), { alert: true, reason: "ok", level: "deep", angle: "E" });
});

test("사람 클릭 세션도 약한 방문이면 처음 판정(기계)을 돌려준다 (B21)", () => {
    const { base } = scannerThenHuman();
    const weakHuman = { ...humanSession, duration: 1, pageCount: 1 };
    const input = { ...base, foundSessions: [scannerSession, weakHuman] };
    const r = evaluateSendWithFallback(input, AFTER_HUMAN, (s) =>
        s.visitorId === weakHuman.visitorId ? { ...input, visitorSessions: [weakHuman], visitorEvents: [] } : input
    );
    assert.equal(r.usedFallback, false);
    assert.equal(r.verdict.chosenSession?.id, scannerSession.id);
    assert.equal(decideAlert(r.input, r.verdict, AFTER_HUMAN).reason, "machine");
});

test("다시 고를 세션은 사람 클릭(발송 2분 뒤)의 click_id로 찾은 자기 사이트 세션만이다 (B21)", () => {
    const { base } = scannerThenHuman();
    assert.equal(humanClickFallbackSession(base, AFTER_HUMAN)?.id, humanSession.id);

    // 2분 안 클릭만 있으면 다시 고르지 않는다 (장비가 두 번 연 것)
    const earlyOnly = {
        ...base,
        clicks: [
            { clickId: SCANNER_CID, clickedAt: SCANNER_CLICK },
            { clickId: HUMAN_CID, clickedAt: plus(SENT, 90 * SEC) },
        ],
    };
    assert.equal(humanClickFallbackSession(earlyOnly, AFTER_HUMAN), null);

    // 사람 클릭 세션이 자매 사이트에만 있으면 후보가 아니다
    const sister = { ...humanSession, siteId: SISTER_SITE_ID };
    assert.equal(humanClickFallbackSession({ ...base, foundSessions: [scannerSession, sister] }, AFTER_HUMAN), null);

    // 처음 고른 세션 자체가 사람 클릭 세션이면 다시 고를 것이 없다
    assert.equal(humanClickFallbackSession({ ...base, foundSessions: [humanSession] }, AFTER_HUMAN), null);

    // now보다 뒤의 사람 클릭은 아직 없는 것이다
    assert.equal(humanClickFallbackSession(base, plus(HUMAN_CLICK, -1 * MIN)), null);
});

test("pickChosenSession은 chosenSessionId를 따르고, own에 없는 id면 가장 이른 세션이다", () => {
    const { base } = scannerThenHuman();
    assert.equal(pickChosenSession(base, AFTER_HUMAN)?.id, scannerSession.id);
    assert.equal(pickChosenSession({ ...base, chosenSessionId: humanSession.id }, AFTER_HUMAN)?.id, humanSession.id);
    assert.equal(pickChosenSession({ ...base, chosenSessionId: 1 }, AFTER_HUMAN)?.id, scannerSession.id);
});

// ── 단계 — B8·B9·B10·B11·B12·B13 ──

test("hero·trust-logos·trust-stats·solution만 본 사람은 깊이 확인 아님 (B8)", () => {
    const r = judge(
        makeInput({ events: [pv("/", 0), sv("hero", 2), sv("trust-logos", 5), sv("trust-stats", 8), sv("solution", 12)] })
    );
    assert.equal(r.v.browsed, true); // 영역 3개 이상이라 둘러봄
    assert.equal(r.v.sawCases || r.v.sawPrice || r.v.sawDetail, false);
    assert.equal(r.v.deepestStage, 4);
    assert.equal(r.d.reason, "not_deep");
});

test("trust-cases 영역 → 사례 봄 → 단계 5, 각도 E (B9)", () => {
    const r = judge(makeInput({ events: [pv("/", 0), sv("hero", 3), sv("trust-cases", 30)] }));
    assert.equal(r.v.sawCases, true);
    assert.equal(r.v.deepestStage, 5);
    assert.deepEqual(r.d, { alert: true, reason: "ok", level: "deep", angle: "E" });
});

test("service-workspace(바뀔 이름)·service-pricing 영역은 서비스 상세로 센다", () => {
    for (const name of ["service-workspace", "service-pricing", "FAQ"]) {
        const v = evaluateSend(makeInput({ events: [sv(name, 10)] }), NOW);
        assert.equal(v.sawDetail, true, name);
        assert.equal(v.sawPrice, false, name);
        assert.equal(v.deepestStage, 5, name);
    }
});

test("subsidy-calc-cta는 SECTION_VIEW일 때만 가격 봄이다", () => {
    assert.equal(evaluateSend(makeInput({ events: [sv("subsidy-calc-cta", 10)] }), NOW).sawPrice, true);
    assert.equal(evaluateSend(makeInput({ events: [click("subsidy-calc-cta", 10)] }), NOW).sawPrice, false);
});

test("/signup/ 페이지 → 신청 시작 → intent, 각도 A (B10)", () => {
    const r = judge(makeInput({ events: [pv("/", 0), pv("/signup/", 20), pv("/signup/email/", 40)] }));
    assert.equal(r.v.signupStart, true);
    assert.equal(r.v.signupScreen, true);
    assert.equal(r.v.deepestStage, 7);
    assert.deepEqual(r.d, { alert: true, reason: "ok", level: "intent", angle: "A" });
});

test("subscribe_step_1·manual_entry_click CUSTOM도 신청 시작이다 (B10)", () => {
    for (const name of ["subscribe_step_1", "manual_entry_click"]) {
        const v = evaluateSend(makeInput({ events: [custom(name, 10)] }), NOW);
        assert.equal(v.signupStart, true, name);
        assert.equal(v.signupScreen, false, name);
    }
});

test("/signup/complete·/main/·subscribe_submit·깔때기 단계 레코드 → 제출, 알림 없음 (B11)", () => {
    const cases: [string, InputOpts][] = [
        ["/signup/complete", { events: [...DEEP_EVENTS, pv("/signup/", 70), pv("/signup/complete/", 120)] }],
        ["/main/", { events: [...DEEP_EVENTS, pv("/main/dashboard", 90)] }],
        ["subscribe_submit", { events: [...DEEP_EVENTS, custom("subscribe_submit", 100)] }],
        ["signup_complete", { events: [...DEEP_EVENTS, custom("signup_complete", 100)] }],
        ["이미 깔때기 안", { events: DEEP_EVENTS, extra: { alreadyInFunnel: true } }],
    ];
    for (const [label, opts] of cases) {
        const r = judge(makeInput(opts));
        assert.equal(r.v.submitted, true, label);
        assert.equal(r.v.deepestStage, 8, label);
        assert.equal(r.d.alert, false, label);
        assert.equal(r.d.reason, "already_in_funnel", label);
    }
});

test("제출한 사람은 짧게 머물러도 약한 방문(기계)으로 보지 않는다 (B11)", () => {
    const r = judge(makeInput({ session: { duration: 1, pageCount: 1 }, extra: { alreadyInFunnel: true } }));
    assert.equal(r.v.machine, false);
    assert.equal(r.d.reason, "already_in_funnel");
});

test("ai_entry_click만 (단계 4) → intent, 각도 A (B12)", () => {
    const r = judge(makeInput({ session: { pageCount: 2 }, events: [pv("/", 0), custom("ai_entry_click", 15), pv("/ai-request/", 16)] }));
    assert.equal(r.v.aiStart, true);
    assert.equal(r.v.signupStart, false);
    assert.equal(r.v.deepestStage, 4);
    assert.deepEqual(r.d, { alert: true, reason: "ok", level: "intent", angle: "A" });
});

test("쿠폰 버튼은 행동(trial)이면서 intent, 각도 A", () => {
    const r = judge(makeInput({ events: [pv("/", 0), click("hero-free-trial", 12)] }));
    assert.equal(r.v.coupon, true);
    assert.equal(r.v.action, true);
    assert.deepEqual(r.d, { alert: true, reason: "ok", level: "intent", angle: "A" });
});

test("consult 버튼 → 행동, 각도 B (B13)", () => {
    const r = judge(makeInput({ events: [pv("/", 0), sv("hero", 3), click("nav-consulting", 20)] }));
    assert.equal(r.v.action, true);
    assert.deepEqual(r.v.actionNames, ["nav-consulting"]);
    assert.equal(r.v.deepestStage, 6);
    assert.deepEqual(r.d, { alert: true, reason: "ok", level: "deep", angle: "B" });
});

test("상담 페이지는 page:<첫 조각>으로 남고 각도 B (B13)", () => {
    const v = evaluateSend(
        makeInput({ events: [pv("/", 0), pv("/consulting/form/", 20), click("floating-phone", 30), click("floating-phone", 31)] }),
        NOW
    );
    assert.deepEqual(v.actionNames, ["floating-phone", "page:consulting"]);
    assert.equal(angleOf(v), "B");
});

test("각도 C·D·E와 행동 우선순위", () => {
    const angle = (events: EventInput[]) => angleOf(evaluateSend(makeInput({ events }), NOW));
    assert.equal(angle([click("nav-demo", 10)]), "C");
    assert.equal(angle([click("hero-trial", 10)]), "C"); // 오피오 체험 버튼 (쿠폰 아님)
    assert.equal(angle([click("nav-demo", 10), click("trust-meeting-cta", 12)]), "B");
    assert.equal(angle([pv("/pricing", 10)]), "D");
    assert.equal(angle([click("footer-brochure", 10), pv("/pricing", 12)]), "D");
    assert.equal(angle([sv("faq", 10)]), "E");
});

test("판정은 첫 클릭부터 30일 안·now까지의 이벤트만 본다", () => {
    const beforeClick = sv("trust-cases", -20); // 고른 세션 시작 20초 전 = 첫 클릭 16초 전
    const afterNow = ev("SECTION_VIEW", "trust-cases", 0, { occurredAt: plus(NOW, 1 * SEC) });
    const v = evaluateSend(makeInput({ events: [pv("/", 0), beforeClick, afterNow] }), NOW);
    assert.equal(v.sawCases, false);
    assert.deepEqual(v.sections, []);

    const day31 = ev("SECTION_VIEW", "trust-cases", 0, { occurredAt: plus(CLICK_AT, 31 * DAY) });
    assert.equal(evaluateSend(makeInput({ events: [day31] }), plus(CLICK_AT, 40 * DAY)).sawCases, false);
});

test("now 뒤의 세션·클릭은 무시한다", () => {
    const futureClick = { clickId: CLICK_ID, clickedAt: plus(NOW, 1 * MIN) };
    const v = evaluateSend(makeInput({ extra: { clicks: [futureClick] } }), NOW);
    assert.equal(v.hasHumanClick, false);
    // 클릭이 없으면 start는 고른 세션 시작
    assert.equal(v.start?.getTime(), SESSION_START.getTime());

    const futureSession = ownSession({ startedAt: plus(NOW, 1 * MIN) });
    const none = evaluateSend(makeInput({ found: [futureSession] }), NOW);
    assert.equal(none.chosenSession, null);
});

test("목록은 처음 본 순서·중복 제거, 페이지는 연속 중복만 뺀다", () => {
    const events = [
        pv("/", 0),
        pv("/?utm_source=sendb", 1),
        sv("hero", 2),
        click("nav-portfolio", 10),
        pv("/portfolio/", 11),
        sv("hero", 12),
        pv("/", 30),
        click("nav-portfolio", 31),
        custom("subscribe_step_1", 40),
    ];
    // 입력 순서가 섞여 와도 시간 순으로 본다
    const v = evaluateSend(makeInput({ events: [...events].reverse() }), NOW);
    assert.deepEqual(v.pagePaths, ["/", "/portfolio/", "/"]);
    assert.deepEqual(v.sections, ["hero"]);
    assert.deepEqual(v.clickNames, ["nav-portfolio"]);
    assert.deepEqual(v.customNames, ["subscribe_step_1"]);
});

test("decideAlert 순서: 기계가 기존 방문자·수신거부보다 먼저다", () => {
    const r = judge(
        makeInput({
            session: { duration: 1 },
            extra: { distinctClickedRecordsForVisitor: 5, unsubscribed: true },
        })
    );
    assert.equal(r.d.reason, "machine");
});

// ── 수신거부 — B14 ──

test("수신거부 → 알림 없음 (B14)", () => {
    const r = judge(makeInput({ events: DEEP_EVENTS, extra: { unsubscribed: true } }));
    assert.equal(r.v.deepestStage, 5);
    assert.deepEqual(r.d, { alert: false, reason: "unsubscribed", level: null, angle: null });
});

test("수신거부 매칭: record_id는 워크스페이스와 상관없이, 메일은 같은 워크스페이스 줄만 막는다 (B14)", () => {
    const index = buildUnsubscribeIndex(
        [
            { recordId: 772051, workspaceId: 9, email: "someone@other.example" },
            { recordId: null, workspaceId: 8, email: " Kim@Sample.CO.KR\t" },
            { recordId: null, workspaceId: 9, email: "lee@sample.co.kr" },
            { recordId: null, workspaceId: 8, email: null },
        ],
        8
    );
    assert.equal(isUnsubscribedBy(index, 772051, "nobody@sample.co.kr"), true);
    // 대소문자·앞뒤 탭·줄바꿈·NBSP·전각 공백이 달라도 같은 주소다
    assert.equal(isUnsubscribedBy(index, 1, "kim@sample.co.kr\n"), true);
    assert.equal(isUnsubscribedBy(index, 1, " KIM@SAMPLE.CO.KR　"), true);
    // 다른 워크스페이스(9)에서 거부한 메일 주소로는 막지 않는다 (거부 범위가 워크스페이스 단위)
    assert.equal(isUnsubscribedBy(index, 1, "lee@sample.co.kr"), false);
    // 빈 주소끼리 맞지 않는다
    assert.equal(isUnsubscribedBy(index, 1, null), false);
    assert.equal(isUnsubscribedBy(index, 1, "  "), false);
});

test("normalizeEmail은 SQL btrim과 같은 문자 집합만 앞뒤에서 지우고 소문자로 바꾼다 (B14)", () => {
    for (const ch of EMAIL_TRIM_CHARS) {
        assert.equal(normalizeEmail(`${ch}${ch}Foo@Bar.com${ch}`), "foo@bar.com", JSON.stringify(ch));
    }
    // 가운데 공백·다른 문자는 그대로 둔다
    assert.equal(normalizeEmail("a b@c.com"), "a b@c.com");
    assert.equal(normalizeEmail(" x@y.com"), " x@y.com");
    assert.equal(normalizeEmail(null), "");
});

// ── 4절 "이미 깔때기 안" — B11 ──

const DIHA_STAGES = [
    { field: "match_stage", value: "신청완료" },
    { field: "match_stage", value: "테스트" },
    { field: "match_stage", value: "구독중" },
];
const DIHA_STAGE_VALUES = DIHA_STAGES.map((s) => s.value);

test("record_events는 type='signup'이거나 label이 깔때기 단계 값이면 깔때기 도달이다 (B11)", () => {
    assert.equal(isFunnelRecordEvent({ type: "signup", label: "가입" }, DIHA_STAGE_VALUES), true);
    assert.equal(isFunnelRecordEvent({ type: "match_stage", label: "신청완료" }, DIHA_STAGE_VALUES), true);
    assert.equal(isFunnelRecordEvent({ type: "status_change", label: "통화 예정" }, DIHA_STAGE_VALUES), false);
    assert.equal(isFunnelRecordEvent({ type: "match_stage", label: null }, DIHA_STAGE_VALUES), false);
});

test("깔때기 판정: data에 단계 칸이 없어도 record_events로 잡고, 깔때기 없는 사이트는 이벤트 규칙만 쓴다 (B11)", () => {
    // 디하 기업 CRM 레코드: data에는 matchStep만 있고 도달은 record_events(type=match_stage, label=신청완료)로만 드러난다
    assert.equal(isRecordInFunnel(DIHA_STAGES, { matchStep: 3 }, true), true);
    assert.equal(isRecordInFunnel(DIHA_STAGES, { matchStep: 3 }, false), false);
    assert.equal(isRecordInFunnel(DIHA_STAGES, { match_stage: "구독중" }, false), true);
    assert.equal(isRecordInFunnel(DIHA_STAGES, { match_stage: "상담중" }, false), false);
    assert.equal(isRecordInFunnel(DIHA_STAGES, null, false), false);
    // 값은 그대로 비교한다 (앞뒤 공백·다른 타입은 단계가 아니다)
    assert.equal(isRecordInFunnel([{ field: "step", value: "3" }], { step: 3 }, false), false);
    // 깔때기가 없는 사이트는 record_events·data가 있어도 false — SUBMIT·/signup/complete·/main/ 이벤트 규칙만 쓴다
    assert.equal(isRecordInFunnel([], { match_stage: "신청완료" }, true), false);
});

test("제출·가입 신호: SUBMIT 이름의 클릭·CUSTOM, /signup/complete, /main/ (B11)", () => {
    const at = { pageUrl: null };
    assert.equal(isSubmitSignal({ eventType: "CUSTOM", eventName: "subscribe_submit", ...at }), true);
    assert.equal(isSubmitSignal({ eventType: "CLICK", eventName: "signup_complete", ...at }), true);
    assert.equal(isSubmitSignal({ eventType: "SECTION_VIEW", eventName: "signup_complete", ...at }), false);
    assert.equal(isSubmitSignal({ eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://designer-hire.com/signup/complete/?x=1" }), true);
    assert.equal(isSubmitSignal({ eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://designer-hire.com/main/dashboard" }), true);
    assert.equal(isSubmitSignal({ eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://designer-hire.com/signup/" }), false);
});

// ── 보내기 직전 재확인 — B22 ──

test("보내기 직전 재확인: 수신거부·가입·제출 신호면 보내지 않고, deep은 살아 있는 intent가 있으면 보내지 않는다 (B22)", () => {
    const base = { level: "deep" as const, intentStatuses: [], alreadyInFunnel: false, unsubscribed: false, submittedSince: false };
    assert.equal(recheckSkipReason(base), null);
    assert.equal(recheckSkipReason({ ...base, unsubscribed: true }), "보내기 전 재확인: 수신거부");
    assert.equal(recheckSkipReason({ ...base, alreadyInFunnel: true }), "보내기 전 재확인: 이미 가입·신청함");
    assert.equal(recheckSkipReason({ ...base, submittedSince: true }), "보내기 전 재확인: 이미 가입·신청함");
    for (const status of ["pending", "processing", "sent"]) {
        assert.equal(recheckSkipReason({ ...base, intentStatuses: [status] }), "보내기 전 재확인: 같은 레코드에 intent 알림이 있음", status);
    }
    // 보내지 못했거나 기록만 한 intent는 deep을 대신하지 못한다
    for (const status of ["failed", "skipped", "dry_run"]) {
        assert.equal(recheckSkipReason({ ...base, intentStatuses: [status] }), null, status);
    }
    // intent 줄 자신은 intent 상태로 막지 않는다
    assert.equal(recheckSkipReason({ ...base, level: "intent", intentStatuses: ["processing"] }), null);
    assert.equal(recheckSkipReason({ ...base, level: "intent", unsubscribed: true }), "보내기 전 재확인: 수신거부");
});

test("4절(깔때기·수신거부)은 알림을 빼기만 한다 — 워커가 4절 없이 먼저 거르는 근거 (B26)", () => {
    const early = plus(SENT, 40 * SEC);
    const cases: [string, InputOpts][] = [
        ["깊이 봄", { events: DEEP_EVENTS }],
        ["신청 시작", { events: SIGNUP_EVENTS }],
        ["약한 방문", { session: { duration: 1, pageCount: 1 } }],
        ["2분 안 클릭만", { clickAt: early, session: { startedAt: plus(early, 2 * SEC), pageCount: 2 }, events: [sv("hero", 3)] }],
        ["둘러봄만", { session: { pageCount: 3 }, events: [sv("hero", 3)] }],
        ["기존 방문자", { events: DEEP_EVENTS, extra: { distinctClickedRecordsForVisitor: 3 } }],
    ];
    const rank = (level: string | null) => (level === "intent" ? 2 : level === "deep" ? 1 : 0);
    for (const [label, opts] of cases) {
        const plain = judge(makeInput(opts));
        for (const extra of [{ alreadyInFunnel: true }, { unsubscribed: true }, { alreadyInFunnel: true, unsubscribed: true }]) {
            const guarded = judge(makeInput({ ...opts, extra: { ...opts.extra, ...extra } }));
            assert.equal(guarded.d.alert, false, `${label} ${JSON.stringify(extra)}`);
            assert.ok(rank(guarded.d.level) <= rank(plain.d.level), label);
        }
    }
    // 사람 클릭 세션으로 다시 판정하는 경우도 같다
    const { base, forSession } = scannerThenHuman();
    for (const extra of [{ alreadyInFunnel: true }, { unsubscribed: true }]) {
        const r = evaluateSendWithFallback({ ...base, ...extra }, AFTER_HUMAN, (s) => ({ ...forSession(s), ...extra }));
        assert.equal(decideAlert(r.input, r.verdict, AFTER_HUMAN).alert, false, JSON.stringify(extra));
    }
});

test("rotateStart는 회차마다 시작 위치를 돌린다", () => {
    assert.deepEqual(rotateStart([8, 9, 14], 0), [8, 9, 14]);
    assert.deepEqual(rotateStart([8, 9, 14], 1), [9, 14, 8]);
    assert.deepEqual(rotateStart([8, 9, 14], 5), [14, 8, 9]);
    assert.deepEqual(rotateStart([8, 9, 14], -1), [14, 8, 9]);
    assert.deepEqual(rotateStart([], 3), []);
});

// ── 판정 가능 시점 — B20 ──

test("마지막 활동 10분 안이면 판정 미룸 (B20)", () => {
    const lastEventAt = plus(SESSION_START, 60 * SEC);
    const input = makeInput({ session: { endedAt: lastEventAt }, events: DEEP_EVENTS });

    const early = judge(input, plus(lastEventAt, 10 * MIN - 1 * SEC));
    assert.equal(early.v.lastActivityAt?.getTime(), lastEventAt.getTime());
    assert.equal(early.d.reason, "not_settled");

    const settled = judge(input, plus(lastEventAt, 10 * MIN));
    assert.equal(settled.d.reason, "ok");
});

test("다시 온 세션의 활동도 마지막 활동이다 (B20)", () => {
    const back = ownSession({
        id: SESSION_ID + 9,
        startedAt: plus(SESSION_START, 1 * HOUR),
        endedAt: plus(SESSION_START, 1 * HOUR + 5 * MIN),
    });
    const r = judge(makeInput({ events: DEEP_EVENTS, others: [back] }), plus(SESSION_START, 1 * HOUR + 8 * MIN));
    assert.equal(r.v.lastActivityAt?.getTime(), plus(SESSION_START, 1 * HOUR + 5 * MIN).getTime());
    assert.equal(r.d.reason, "not_settled");
});

test("now 뒤에 끝난 세션(과거 now 미리보기)은 아직 이어지는 중으로 본다 (B20)", () => {
    const now = plus(SESSION_START, 30 * MIN);
    const r = judge(makeInput({ session: { endedAt: plus(SESSION_START, 2 * HOUR) }, events: DEEP_EVENTS }), now);
    assert.equal(r.v.lastActivityAt?.getTime(), now.getTime());
    assert.equal(r.d.reason, "not_settled");
});

// ── 예약·기한 — B15 ──

test("근무시간 밖 탐지 → 다음 평일 09:00 예약 (B15)", () => {
    // 금 19:00 → 월 09:00, 토 → 월 09:00, 목 07:30 → 그날 09:00
    assert.equal(
        nextAlertTime(new Date("2026-10-02T19:00:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
    assert.equal(
        nextAlertTime(new Date("2026-10-03T13:00:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
    assert.equal(
        nextAlertTime(new Date("2026-10-01T07:30:00+09:00")).toISOString(),
        new Date("2026-10-01T09:00:00+09:00").toISOString()
    );
    const inHours = new Date("2026-10-01T14:20:00+09:00");
    assert.equal(nextAlertTime(inHours).getTime(), inHours.getTime());
});

test("기한 글자: 각도 A (B15)", () => {
    assert.equal(deadlineText("A", new Date("2026-10-02T14:20:00+09:00")), "1시간 안 · 10/2(금) 15:20까지");
    // 근무시간 밖 카드는 다음 근무 시작에 읽힌다 — "다음 평일" 대신 날짜·요일
    assert.equal(deadlineText("A", new Date("2026-10-02T18:30:00+09:00")), "출근하면 바로 · 10/5(월) 10:00까지");
    assert.equal(deadlineText("A", new Date("2026-10-05T07:00:00+09:00")), "출근하면 바로 · 10/5(월) 10:00까지");
});

test("기한 글자: 각도 B (B15)", () => {
    assert.equal(deadlineText("B", new Date("2026-10-01T09:00:00+09:00")), "오늘 안 · 10/1(목) 18:00까지");
    assert.equal(deadlineText("B", new Date("2026-10-03T11:00:00+09:00")), "출근하면 먼저 · 10/5(월) 12:00까지");
    // 평일 이른 아침이면 그날 12:00 (규칙 그대로)
    assert.equal(deadlineText("B", new Date("2026-10-06T07:00:00+09:00")), "출근하면 먼저 · 10/6(화) 12:00까지");
});

test("기한 글자: 각도 C~E는 다음 평일 정오 (B15)", () => {
    assert.equal(deadlineText("E", new Date("2026-10-01T15:00:00+09:00")), "10/2(금) 12:00까지");
    assert.equal(deadlineText("C", new Date("2026-10-02T10:00:00+09:00")), "10/5(월) 12:00까지");
    assert.equal(deadlineText("D", new Date("2026-10-04T22:00:00+09:00")), "10/5(월) 12:00까지");
});

test("근무시간 밖 B와 E는 기한 시각이 같아도 글자로 급함이 갈리고, 12:00을 '오전까지'라 쓰지 않는다 (B15)", () => {
    const sat = new Date("2026-10-03T11:00:00+09:00");
    const b = deadlineText("B", sat);
    const e = deadlineText("E", sat);
    // 기한 규칙은 그대로 — 둘 다 월 12:00
    assert.ok(b.endsWith("10/5(월) 12:00까지") && e.endsWith("10/5(월) 12:00까지"), `${b} / ${e}`);
    assert.notEqual(b, e);
    assert.ok(b.startsWith("출근하면 먼저"));
    for (const angle of ["A", "B", "C", "D", "E"] as const) {
        for (const at of [sat, new Date("2026-10-01T15:00:00+09:00"), new Date("2026-10-05T07:00:00+09:00")]) {
            assert.ok(!deadlineText(angle, at).includes("오전"), `${angle} ${at.toISOString()}`);
        }
    }
});

// ── 수준 올라감 — B16 ──

test("deep 뒤 intent는 다시 보냄, intent 뒤 deep은 보내지 않음 (B16)", () => {
    assert.equal(isLevelUpgrade([], "deep"), true);
    assert.equal(isLevelUpgrade([], "intent"), true);
    assert.equal(isLevelUpgrade(["deep"], "intent"), true);
    assert.equal(isLevelUpgrade(["deep"], "deep"), false);
    assert.equal(isLevelUpgrade(["intent"], "deep"), false);
    assert.equal(isLevelUpgrade(["intent"], "intent"), false);
    assert.equal(isLevelUpgrade(["deep", "intent"], "intent"), false);
});

// ── 카드 — B17 ──

function deepVerdict(): JourneyVerdict {
    return evaluateSend(
        makeInput({
            session: { pageCount: 2 },
            events: [pv("/", 0), sv("hero", 10), sv("trust-cases", 40), click("nav-portfolio", 55), pv("/portfolio/?utm_source=x", 56)],
        }),
        NOW
    );
}

function evidence(over: Partial<AlertEvidence> = {}): AlertEvidence {
    const firstSent = new Date("2026-09-24T10:00:00+09:00");
    return {
        businessName: "디하",
        recordId: 772051,
        integratedCode: "DH-0772051",
        partitionName: "9월 콜드메일 2차",
        listType: listTypeOf("9월 콜드메일 2차"),
        baseUrl: "https://sendb.kr/",
        level: "deep",
        angle: "E",
        deadline: deadlineText("E", NOW),
        verdict: deepVerdict(),
        alertSend: { sentAt: SENT, subject: "디자이너 채용, 월 구독으로 해결하세요", nth: 2, totalSends: 2 },
        fields: [
            { label: "회사명", value: "주식회사 샘플컴퍼니", key: "companyName", fieldType: "text" },
            { label: "담당자", value: "박서연", key: "contactName", fieldType: "text" },
            { label: "이메일", value: "seoyeon@sample.example", key: "email", fieldType: "email" },
            { label: "연락처", value: "010-1234-5678", key: "phone", fieldType: "phone" },
            { label: "공고키워드", value: "UIUX 디자이너", key: "jobKeyword", fieldType: "text" },
        ],
        fieldLabels: { companyName: "회사명", contactName: "담당자", email: "이메일", phone: "연락처", callStatus: "콜 상태" },
        companyResearch: {
            industry: "화장품 제조",
            employees: "12명",
            website: "https://sample.example",
            description: "기초 화장품을 만들어 온라인으로 판다.",
        },
        emails: [
            {
                sentAt: firstSent,
                subject: "디자인 외주, 이제 구독으로",
                ruleName: "디하 첫 메일",
                triggerType: "partition_import",
                clicks: [],
                isAlertSend: false,
            },
            {
                sentAt: SENT,
                subject: "디자이너 채용, 월 구독으로 해결하세요",
                ruleName: null,
                triggerType: "followup",
                clicks: [
                    { clickedAt: plus(SENT, 40 * SEC), human: false },
                    { clickedAt: CLICK_AT, human: true },
                ],
                isAlertSend: true,
            },
        ],
        labels: { "SECTION_VIEW:trust-cases": "고객 사례" },
        clickTexts: { "nav-portfolio": "포트폴리오" },
        statusHistory: [
            { occurredAt: new Date("2026-09-30T10:00:00+09:00"), type: "callStatus", label: "부재" },
            { occurredAt: firstSent, type: "email_sent", label: "첫 메일 발송" },
        ],
        memos: [{ createdAt: new Date("2026-09-30T14:12:00+09:00"), author: "김영업", content: "통화 안 받음.\n다음 주 다시" }],
        otherRecords: [],
        alimtalkCount: 1,
        ...over,
    };
}

test("카드는 설계 5절 모양 그대로다 (B17)", () => {
    const expected = [
        "⏰ *10/2(금) 12:00까지*",
        "👤 박서연 · 010-1234-5678 · seoyeon@sample.example · 주식회사 샘플컴퍼니",
        "🔔 *디하 · 깊이 들어온 사람* — E 사례·상세 보여 주기",
        "레코드 DH-0772051 (#772051) · 9월 콜드메일 2차 · 구매 명단",
        "<https://sendb.kr/records?id=772051|레코드 열기> · <https://sendb.kr/records/772051/journey|고객 여정>",
        "",
        "*왜 알림이 왔나*",
        '메일 2통째 "디자이너 채용, 월 구독으로 해결하세요"에서 10/1 10:06 클릭 (발송 6분 뒤) → 서비스 깊이 확인, 가입은 안 함',
        "",
        "*사이트에서 한 일* (첫 방문 10/1 10:06, 체류 2분 55초, 2쪽)",
        "• 본 페이지: / → /portfolio/",
        "• 본 영역: hero, 고객 사례",
        "• 누른 것: 포트폴리오",
        "",
        "*CRM 정보*",
        "• 회사명: 주식회사 샘플컴퍼니",
        "• 담당자: 박서연",
        "• 이메일: seoyeon@sample.example",
        "• 연락처: 010-1234-5678",
        "• 공고키워드: UIUX 디자이너",
        "",
        "*회사 조사*",
        "업종 화장품 제조 · 직원 12명 · 웹사이트 https://sample.example",
        "기초 화장품을 만들어 온라인으로 판다.",
        "",
        "*받은 메일* (2통)",
        "1. 9/24 10:00 [디하 첫 메일] 디자인 외주, 이제 구독으로 — 클릭 없음",
        "2. 10/1 10:00 [followup] 디자이너 채용, 월 구독으로 해결하세요 — 클릭 10:06 (사람) ← 이번 알림",
        "",
        "*상태 이력*",
        "• 9/24 10:00 email_sent: 첫 메일 발송",
        "• 9/30 10:00 콜 상태: 부재",
        "",
        "*메모*",
        "• 9/30 14:12 김영업: 통화 안 받음. 다음 주 다시",
        "",
        "*알림톡* 1건 보냄",
        "",
        '_고객에게 "사이트에서 무엇을 봤는지"는 말하지 않습니다._',
    ].join("\n");
    assert.equal(buildAlertMessage(evidence(), NOW), expected);
});

test("빈 칸은 빼되 머리·왜 알림이 왔나·사이트에서 한 일은 남긴다 (B17)", () => {
    const msg = buildAlertMessage(
        evidence({
            integratedCode: null,
            fields: [],
            companyResearch: null,
            emails: [],
            statusHistory: [],
            memos: [],
            otherRecords: [],
            alimtalkCount: 0,
            verdict: evaluateSend(makeInput({ events: [sv("faq", 10)] }), NOW),
        }),
        NOW
    );
    assert.ok(msg.includes("레코드 #772051 · 9월 콜드메일 2차 · 구매 명단"));
    assert.ok(msg.includes("*왜 알림이 왔나*"));
    assert.ok(msg.includes("*사이트에서 한 일* (첫 방문 10/1 10:06, 체류 2분 55초, 1쪽)\n• 본 영역: faq"));
    for (const head of ["*CRM 정보*", "*회사 조사*", "*받은 메일*", "*상태 이력*", "*메모*", "*같은 사람의 다른 레코드*", "*알림톡*"]) {
        assert.ok(!msg.includes(head), head);
    }
    assert.ok(!msg.includes("• 본 페이지"));
    assert.ok(msg.endsWith(MESSAGE_FOOTER));
});

test("사용자 값의 < > 는 ‹ › 로 바뀌어 링크·멘션 문법이 깨지지 않는다 (B17)", () => {
    const verdict = evaluateSend(
        makeInput({ events: [pv("/<img src=x>/", 0), sv("trust-cases", 5), click("<users/all>", 6)] }),
        NOW
    );
    const msg = buildAlertMessage(
        evidence({
            businessName: "디하<b>",
            verdict,
            alertSend: { sentAt: SENT, subject: "<https://evil.example|여기를 누르세요>", nth: 1, totalSends: 1 },
            fields: [{ label: "담당자 <메모>", value: "<users/all> 확인 부탁" }],
            clickTexts: {},
            memos: [{ createdAt: NOW, author: "<봇>", content: "<https://evil.example|피싱>" }],
        }),
        NOW
    );
    // < 는 우리가 만든 링크 두 개에만 남는다
    assert.equal(msg.split("<").length - 1, 2);
    assert.equal(msg.split(">").length - 1, 2);
    assert.ok(msg.includes("*디하‹b› · 깊이 들어온 사람*"));
    assert.ok(msg.includes('"‹https://evil.example|여기를 누르세요›"'));
    assert.ok(msg.includes("• 담당자 ‹메모›: ‹users/all› 확인 부탁"));
    assert.ok(msg.includes("• 본 페이지: /‹img src=x›/"));
    assert.ok(msg.includes("• 누른 것: ‹users/all›"));
});

test("카드는 3,800자에서 줄 단위로 잘리고 안내 줄과 마지막 당부가 붙는다 (B17)", () => {
    const fields = Array.from({ length: 80 }, (_, i) => ({ label: `칸 ${i + 1}`, value: "가".repeat(300) }));
    const msg = buildAlertMessage(evidence({ fields }), NOW);
    assert.ok(msg.length <= MESSAGE_MAX_CHARS, `길이 ${msg.length}`);
    assert.ok(msg.endsWith(`\n${MESSAGE_TRUNCATION_NOTE}\n\n${MESSAGE_FOOTER}`));
    // 링크 줄은 온전하고, 잘린 바로 앞 줄도 온전한 칸 한 줄이다 (값 120자 + …)
    assert.ok(msg.includes("<https://sendb.kr/records?id=772051|레코드 열기>"));
    const lines = msg.split("\n");
    const lastField = lines[lines.indexOf(MESSAGE_TRUNCATION_NOTE) - 1];
    assert.match(lastField, /^• 칸 \d+: 가{120}…$/);
});

test("짧은 카드에는 자르기 안내가 붙지 않는다 (B17)", () => {
    const msg = buildAlertMessage(evidence(), NOW);
    assert.ok(!msg.includes(MESSAGE_TRUNCATION_NOTE));
});

test("목록은 정한 개수까지만 보이고 나머지 수를 알린다 (B17)", () => {
    const pages = Array.from({ length: 20 }, (_, i) => pv(`/portfolio/${i + 1}/`, i * 10));
    const sections = Array.from({ length: 18 }, (_, i) => sv(`section-${i + 1}`, i + 1));
    const verdict = evaluateSend(makeInput({ session: { pageCount: 20 }, events: [...pages, ...sections] }), NOW);
    const emails = Array.from({ length: 11 }, (_, i) => ({
        sentAt: plus(SENT, (i - 10) * DAY),
        subject: `메일 ${i + 1}`,
        ruleName: null,
        triggerType: null,
        clicks: i === 10 ? [{ clickedAt: plus(SENT, 30 * SEC), human: false }] : [],
        isAlertSend: i === 10,
    }));
    const statusHistory = Array.from({ length: 10 }, (_, i) => ({
        occurredAt: plus(SENT, -(10 - i) * DAY),
        type: "status_change",
        label: `상태 ${i + 1}`,
    }));
    const memos = Array.from({ length: 5 }, (_, i) => ({ createdAt: plus(SENT, -(5 - i) * DAY), author: null, content: `메모 ${i + 1}` }));
    const msg = buildAlertMessage(
        evidence({ verdict, emails, statusHistory, memos, alertSend: { sentAt: SENT, subject: "메일 11", nth: 11, totalSends: 11 } }),
        NOW
    );
    assert.ok(msg.includes("/portfolio/12/ 외 8개"));
    assert.ok(!msg.includes("/portfolio/13/"));
    assert.ok(msg.includes("section-15 외 3개"));
    assert.ok(msg.includes("*받은 메일* (11통, 최근 8통)"));
    assert.ok(!msg.includes("\n3. "));
    assert.ok(msg.includes("\n4. 9/24 10:00 메일 4 — 클릭 없음"));
    assert.ok(msg.includes("\n11. 10/1 10:00 메일 11 — 클릭 10:00 (발송 직후·기계 의심) ← 이번 알림"));
    assert.ok(msg.includes("*상태 이력* (최근 8)"));
    assert.ok(!msg.includes("상태 2\n"));
    assert.ok(msg.includes("상태 10"));
    assert.ok(msg.includes("*메모* (최근 3)"));
    assert.ok(!msg.includes("메모 2\n"));
    assert.ok(msg.includes("작성자 없음: 메모 5"));
});

test("빈 메모가 최신에 있어도 내용 있는 메모를 최근 3개까지 보인다 (B17)", () => {
    // 워커는 메모를 자르지 않고 넘긴다 — 예전처럼 최신 3개를 먼저 자르면 빈 메모 둘 때문에 하나만 보였다
    const memos = [
        { createdAt: plus(SENT, -5 * DAY), author: "김영업", content: "메모 1" },
        { createdAt: plus(SENT, -4 * DAY), author: "김영업", content: "메모 2" },
        { createdAt: plus(SENT, -3 * DAY), author: "김영업", content: "메모 3" },
        { createdAt: plus(SENT, -2 * DAY), author: "김영업", content: "   " },
        { createdAt: plus(SENT, -1 * DAY), author: "김영업", content: "" },
    ];
    const msg = buildAlertMessage(evidence({ memos }), NOW);
    assert.ok(msg.includes("*메모*\n• 9/26 10:00 김영업: 메모 1\n• 9/27 10:00 김영업: 메모 2\n• 9/28 10:00 김영업: 메모 3"));
    assert.ok(!msg.includes("*메모* (최근 3)"));
});

test("긴 한글 슬러그 경로가 여러 개여도 CRM 정보·받은 메일·메모가 잘려 나가지 않는다 (B17)", () => {
    // 블로그·인사이트 글 주소는 퍼센트 인코딩된 채 저장된다 (한글 한 글자 = 9자)
    const slug = encodeURIComponent("홈페이지-리뉴얼-비용은-얼마나-들까-중소기업-디자인-외주-체크리스트-총정리");
    const events = Array.from({ length: 12 }, (_, i) => pv(`/insight/h/${slug}-${i + 1}/`, i * 10));
    const verdict = evaluateSend(makeInput({ session: { pageCount: 12 }, events }), NOW);
    // 판정은 원문 경로로 한다
    assert.ok(verdict.pagePaths[0].length > 300, `경로 길이 ${verdict.pagePaths[0].length}`);
    assert.equal(verdict.sawDetail, true);

    const msg = buildAlertMessage(evidence({ verdict }), NOW);
    assert.ok(msg.length <= MESSAGE_MAX_CHARS);
    assert.ok(!msg.includes(MESSAGE_TRUNCATION_NOTE));
    for (const head of ["*CRM 정보*", "*회사 조사*", "*받은 메일*", "*상태 이력*", "*메모*", "*알림톡*"]) {
        assert.ok(msg.includes(head), head);
    }
    const pageLine = msg.split("\n").find((l) => l.startsWith("• 본 페이지: ")) ?? "";
    // 카드에서는 풀어서 보이고, 항목마다·줄마다 길이를 자른다
    assert.ok(pageLine.includes("/insight/h/홈페이지-리뉴얼-비용은"), pageLine);
    assert.ok(!pageLine.includes("%ED"), pageLine);
    assert.match(pageLine, / 외 \d+개$/);
    assert.ok(pageLine.length < 450, `줄 길이 ${pageLine.length}`);
});

test("경로의 %3C·%3E는 풀린 뒤에도 ‹ ›로 바뀌고, 잘못된 % 순서는 원문 그대로 보인다 (B17)", () => {
    const verdict = evaluateSend(
        makeInput({ events: [pv("/%3Cusers%2Fall%3E/", 0), pv("/blog/%E0%A4%A/", 5), sv("trust-cases", 6)] }),
        NOW
    );
    const msg = buildAlertMessage(evidence({ verdict }), NOW);
    assert.ok(msg.includes("• 본 페이지: /‹users%2Fall›/ → /blog/%E0%A4%A/"), msg);
    assert.equal(msg.split("<").length - 1, 2);
});

test("긴 제목·버튼 이름도 잘라 카드 한 줄이 예산을 다 먹지 않는다 (B17)", () => {
    const verdict = evaluateSend(makeInput({ events: [sv("trust-cases", 5), click("x".repeat(500), 6)] }), NOW);
    const msg = buildAlertMessage(
        evidence({ verdict, clickTexts: {}, alertSend: { sentAt: SENT, subject: "가".repeat(1000), nth: 2, totalSends: 2 } }),
        NOW
    );
    assert.ok(msg.includes(`"${"가".repeat(100)}…"에서`));
    assert.ok(msg.includes(`• 누른 것: ${"x".repeat(80)}…`));
    assert.ok(!msg.includes(MESSAGE_TRUNCATION_NOTE));
});

test("AI 입력만 누른 사람은 단계 옆에 표시한다 (B12·B17)", () => {
    const verdict = evaluateSend(
        makeInput({ session: { pageCount: 2 }, events: [pv("/", 0), custom("ai_entry_click", 15)] }),
        NOW
    );
    const msg = buildAlertMessage(
        evidence({ verdict, level: "intent", angle: "A", deadline: deadlineText("A", NOW), labels: { "CUSTOM:ai_entry_click": "AI 의뢰 입력 시작" } }),
        NOW
    );
    assert.ok(msg.includes("→ 둘러봄 · AI 입력 시작, 가입은 안 함"));
    assert.ok(msg.includes("• 신청 흐름: AI 의뢰 입력 시작"));
    assert.ok(
        msg.startsWith(
            "⏰ *1시간 안 · 10/1(목) 13:00까지*\n👤 박서연 · 010-1234-5678 · seoyeon@sample.example · 주식회사 샘플컴퍼니\n🔔 *디하 · 깊이 들어온 사람* — A 신청 이어 하기\n"
        ),
        msg
    );
});

// ── 카드 머리: 기한 → 연락 요약 (M-DA-1) ──

/** 시험 환경 시드와 같은 칸 (회사명·담당자·이메일·연락처·업종·키워드) */
const SEED_FIELDS: AlertEvidence["fields"] = [
    { label: "회사명", value: "나래디자인(시험)", key: "companyName", fieldType: "text" },
    { label: "담당자", value: "이지우(시험)", key: "contactName", fieldType: "text" },
    { label: "이메일", value: "s2.consult@company-b.test", key: "email", fieldType: "email" },
    { label: "연락처", value: "010-0000-0002", key: "phone", fieldType: "phone" },
    { label: "업종", value: "유통·커머스", key: "industry", fieldType: "select" },
    { label: "공고키워드", value: "UI/UX 디자이너", key: "jobKeyword", fieldType: "text" },
];
const cp = (s: string) => Array.from(s).length;

test("카드 첫 줄은 기한, 둘째 줄은 이름·전화·메일·회사 — 연락처가 46자 안에 온다 (B17)", () => {
    // 가장 긴 기한 글자 (근무시간 밖 B, 두 자리 날짜)
    const deadline = deadlineText("B", new Date("2026-10-10T11:00:00+09:00"));
    assert.equal(deadline, "출근하면 먼저 · 10/12(월) 12:00까지");
    const msg = buildAlertMessage(evidence({ angle: "B", deadline, fields: SEED_FIELDS }), NOW);
    const lines = msg.split("\n");
    assert.equal(lines[0], `⏰ *${deadline}*`);
    assert.equal(lines[1], "👤 이지우(시험) · 010-0000-0002 · s2.consult@company-b.test · 나래디자인(시험)");
    assert.equal(lines[2], "🔔 *디하 · 깊이 들어온 사람* — B 바로 상담 일정");
    const phoneAt = cp(msg.slice(0, msg.indexOf("010-0000-0002")));
    assert.ok(phoneAt <= 46, `연락처까지 ${phoneAt}자`);
    // 같은 값은 CRM 정보에도 라벨과 함께 그대로 남는다 (아무것도 빼지 않는다)
    for (const f of SEED_FIELDS) assert.ok(msg.includes(`\n• ${f.label}: ${f.value}\n`), f.label);
});

test("연락할 칸이 없으면 둘째 줄을 두지 않고, 메일·전화가 여럿이면 전부 한 번씩 보인다 (B17)", () => {
    const none = buildAlertMessage(evidence({ fields: [{ label: "공고키워드", value: "웹디자이너" }] }), NOW);
    assert.ok(none.startsWith("⏰ *10/2(금) 12:00까지*\n🔔 *디하 · 깊이 들어온 사람*"), none);
    assert.ok(!none.includes("👤"));

    const many = buildAlertMessage(
        evidence({
            fields: [
                { label: "담당자", value: "박서연", key: "contactName", fieldType: "text" },
                { label: "대표자", value: "김대표", key: "ceoName", fieldType: "text" },
                { label: "휴대폰", value: "010-1234-5678", key: "mobile", fieldType: "phone" },
                { label: "회사 전화", value: "02-123-4567", key: "tel", fieldType: "phone" },
                { label: "이메일", value: "a@sample.example", key: "email", fieldType: "email" },
                { label: "세금계산서 메일", value: "a@sample.example", key: "taxEmail", fieldType: "email" },
            ],
        }),
        NOW
    );
    assert.equal(many.split("\n")[1], "👤 박서연 · 010-1234-5678 · 02-123-4567 · a@sample.example");
});

test("contactKindOf: 메일·전화는 칸 형식으로, text 칸은 키·라벨(메일·전화는 값 모양까지)로 고른다", () => {
    const k = (label: string, value: string, fieldType?: string, key?: string) => contactKindOf({ label, value, fieldType, key });
    assert.equal(k("아무 이름", "x", "email"), "email");
    assert.equal(k("아무 이름", "x", "phone"), "phone");
    assert.equal(k("담당자", "박서연", "text"), "name");
    assert.equal(k("이름", "박서연"), "name");
    assert.equal(k("Name", "Kim", "text", "contact_name"), "name");
    assert.equal(k("회사명", "샘플", "text"), "company");
    assert.equal(k("상호", "샘플"), "company");
    // text 칸이어도 라벨 힌트와 값 모양이 맞으면 메일·전화
    assert.equal(k("이메일", "a@b.example", "text"), "email");
    assert.equal(k("담당자 연락처", "010 1234 5678", "text"), "phone");
    // 힌트만 있고 값이 아니면 아니다
    assert.equal(k("이메일 수신 동의", "예", "text"), null);
    assert.equal(k("연락처 메모", "오후에만 통화 가능", "text"), null);
    // select·number 같은 다른 형식은 이름·회사로 보지 않는다
    assert.equal(k("대표", "예", "select"), null);
    assert.equal(k("업종", "디자인", "select"), null);
    assert.equal(k("공고키워드", "웹디자이너", "text"), null);
});

test("연락 요약도 < > 를 바꾸고 이름은 20자까지만 보인다 (전체 값은 CRM 정보에 남는다) (B17)", () => {
    assert.equal(
        contactSummaryOf([
            { label: "담당자", value: "<users/all> 가나다라마바사아자차카타파하", fieldType: "text" },
            { label: "이메일", value: "a@b.example", fieldType: "email" },
        ]),
        "‹users/all› 가나다라마바사아… · a@b.example"
    );
    assert.equal(contactSummaryOf([]), "");
    // 메일 칸이 아주 많아도 6개까지만 보이고 나머지 수를 알린다
    const many = Array.from({ length: 10 }, (_, i) => ({ label: `메일 ${i + 1}`, value: `m${i + 1}@b.example`, fieldType: "email" }));
    assert.equal(contactSummaryOf(many), "m1@b.example · m2@b.example · m3@b.example · m4@b.example · m5@b.example · m6@b.example 외 4개");
});

test("상태 이력은 칸 키 대신 칸 라벨을 보이고, 모르는 type·원형 이름은 그대로 보인다 (B17)", () => {
    const msg = buildAlertMessage(
        evidence({
            statusHistory: [
                { occurredAt: plus(SENT, -2 * DAY), type: "callStatus", label: "부재" },
                { occurredAt: plus(SENT, -1 * DAY), type: "constructor", label: "x" },
                { occurredAt: SENT, type: "signup", label: "가입" },
            ],
        }),
        NOW
    );
    assert.ok(msg.includes("*상태 이력*\n• 9/29 10:00 콜 상태: 부재\n• 9/30 10:00 constructor: x\n• 10/1 10:00 signup: 가입"), msg);
    assert.ok(!/^• \d+\/\d+ \d\d:\d\d callStatus: /m.test(msg));
});

// ── 미리보기를 브라우저로 열 때 (M-DA-2) ──

test("prefersHtml: 브라우저 주소창만 HTML, fetch·API 클라이언트는 JSON", () => {
    // Edge·Chrome 주소창
    assert.equal(
        prefersHtml("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"),
        true
    );
    assert.equal(prefersHtml("text/html"), true);
    // fetch 기본값·curl·Playwright request
    assert.equal(prefersHtml("*/*"), false);
    assert.equal(prefersHtml(null), false);
    assert.equal(prefersHtml(""), false);
    assert.equal(prefersHtml("application/json"), false);
    assert.equal(prefersHtml("application/json, text/plain, */*"), false);
    // 같으면 JSON (지금까지와 같게)
    assert.equal(prefersHtml("application/json, text/html"), false);
    assert.equal(prefersHtml("text/html;q=0.5, application/json"), false);
    assert.equal(prefersHtml("text/html, application/*;q=0.9"), true);
    assert.equal(prefersHtml("text/html;q=0"), false);
});

test("chatTextToHtml: 굵게·기울임·링크로 바꾸고, 사용자 값은 모두 이스케이프한다", () => {
    const html = chatTextToHtml(
        [
            "⏰ *오늘 안 · 10/1(목) 18:00까지*",
            "<https://sendb.kr/records?id=1&x=2|레코드 열기> · <https://sendb.kr/records/1/journey|고객 여정>",
            "• 담당자: ‹script›alert(1)‹/script› <img src=x onerror=alert(1)> & \"따옴표\" 'a'",
            "업종 디자인 · 웹사이트 https://company-a.test.",
            "• 이메일: s1_intent@company_a.test",
            '_고객에게 "사이트에서 무엇을 봤는지"는 말하지 않습니다._',
        ].join("\n")
    );
    const lines = html.split("\n");
    assert.equal(lines[0], "⏰ <b>오늘 안 · 10/1(목) 18:00까지</b>");
    assert.equal(
        lines[1],
        '<a href="https://sendb.kr/records?id=1&amp;x=2" target="_blank" rel="noopener noreferrer">레코드 열기</a> · ' +
            '<a href="https://sendb.kr/records/1/journey" target="_blank" rel="noopener noreferrer">고객 여정</a>'
    );
    assert.equal(lines[2], "• 담당자: ‹script›alert(1)‹/script› &lt;img src=x onerror=alert(1)&gt; &amp; &quot;따옴표&quot; &#39;a&#39;");
    // 주소 끝의 마침표는 링크에 넣지 않는다
    assert.equal(lines[3], '업종 디자인 · 웹사이트 <a href="https://company-a.test" target="_blank" rel="noopener noreferrer">https://company-a.test</a>.');
    // 낱말 안의 _는 기울임이 아니다
    assert.equal(lines[4], "• 이메일: s1_intent@company_a.test");
    assert.equal(lines[5], "<i>고객에게 &quot;사이트에서 무엇을 봤는지&quot;는 말하지 않습니다.</i>");
    assert.ok(!/<(?!\/?(b|i|s|code|a)[\s>])/.test(html), html);
});

test("chatTextToHtml: javascript: 같은 주소는 링크가 되지 않는다", () => {
    const html = chatTextToHtml("<javascript:alert(1)|누르기> <data:text/html,x|x>");
    assert.ok(!html.includes("<a "), html);
    assert.equal(html, "&lt;javascript:alert(1)|누르기&gt; &lt;data:text/html,x|x&gt;");
});

/** 브라우저 innerText 흉내 — 태그를 지우고 엔티티를 푼다 (블록 사이는 줄바꿈 하나) */
function pageText(html: string): string {
    const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    return body
        .replace(/<\/(div|article|main|footer)>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/\n+/g, "\n")
        .trim();
}

test("미리보기 HTML: 같은 카드를 줄바꿈·굵게·링크로 보이고, 첫 카드 연락처가 맨 위 63자 안에 온다 (M-DA-2)", () => {
    const deadline = deadlineText("A", new Date("2026-10-10T11:00:00+09:00"));
    const message = buildAlertMessage(
        evidence({ angle: "A", level: "intent", deadline, fields: SEED_FIELDS, businessName: "디자이너하이어(시험)" }),
        NOW
    );
    const html = renderDeepAlertPreviewHtml(
        {
            candidates: 12,
            items: [
                { recordId: 772051, level: "intent", angle: "A", deepestStage: 7, message },
                { recordId: 2, level: "deep", angle: "E", deepestStage: 5, message: buildAlertMessage(evidence(), NOW) },
            ],
            skippedByReason: { machine: 2, existing_visitor: 1, already_in_funnel: 2, not_settled: 1, unsubscribed: 1, odd_reason: 0 },
        },
        { workspaceId: 1, now: new Date("2026-10-10T11:00:00+09:00"), nowGiven: true }
    );
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(!html.includes("\\n"));
    const text = pageText(html);
    assert.ok(text.startsWith("카드 2 · 후보 12 · 제외 7\n⏰ 출근하면 바로 · 10/12(월) 10:00까지\n👤 이지우(시험) · 010-0000-0002"), text.slice(0, 200));
    const contactAt = cp(text.slice(0, text.indexOf("010-0000-0002")));
    assert.ok(contactAt <= 63, `연락처까지 ${contactAt}자`);
    // 카드 글자는 하나도 빠지지 않는다 (꾸밈 기호만 태그로 바뀐다)
    const plain = message
        .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2")
        .replace(/(^|\s)\*([^*\n]+)\*/g, "$1$2")
        .replace(/(^|\s)_([^_\n]+)_(?=$|\s)/g, "$1$2")
        .replace(/\n+/g, "\n");
    assert.ok(text.includes(plain), "카드 글자 전부");
    assert.ok(html.includes('<a href="https://sendb.kr/records?id=772051" target="_blank" rel="noopener noreferrer">레코드 열기</a>'));
    assert.ok(html.includes("<b>디자이너하이어(시험) · 깊이 들어온 사람</b>"));
    // 수준·각도·단계와 건너뛴 이유는 카드 뒤·맨 아래에
    assert.ok(text.includes("레코드 #772051 · 수준 intent · 각도 A 신청 이어 하기 · 단계 7 신청 시작"));
    assert.ok(text.includes("제외 이유: 기계 방문 2 · 이미 가입·신청 2 · 기존 방문자 1 · 아직 활동 중(10분 대기) 1 · 수신거부 1"), text);
    assert.ok(!text.includes("odd_reason"));
    assert.ok(text.includes("워크스페이스 1 · 판정 시점 10/10(토) 11:00 (now로 정한 시점)"));
});

test("미리보기 HTML: 카드가 없을 때와 오류일 때, 사용자 값·오류 글은 이스케이프한다", () => {
    const html = renderDeepAlertPreviewHtml(
        { candidates: 3, items: [], skippedByReason: { not_deep: 3, "<b>x</b>": 1 } },
        { workspaceId: 9, now: NOW, nowGiven: false }
    );
    const text = pageText(html);
    assert.ok(text.startsWith("카드 0 · 후보 3 · 제외 4\n지금 판정하면 나갈 카드가 없습니다."), text);
    assert.ok(text.includes("깊이 부족 3 · <b>x</b> 1"));
    assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
    assert.ok(text.includes("(지금)"));

    const err = renderDeepAlertPreviewErrorHtml("다른 미리보기가 <도는> 중입니다.");
    assert.ok(err.includes("다른 미리보기가 &lt;도는&gt; 중입니다."));
});

// ── 설정 — B18 ──

const COMMON_HOOK = "https://chat.example.test/v1/spaces/COMMON/messages?key=fake-key&token=fake-token";
const BOL_HOOK = "https://chat.example.test/v1/spaces/BOL/messages?key=fake-key&token=fake-token-2";

test("모드 기본값 dry_run, 허용 워크스페이스 없으면 처리 안 함 (B18)", () => {
    assert.deepEqual(resolveAlertConfig({}), { mode: "dry_run", workspaceIds: [], webhookByWorkspace: {} });
    assert.equal(resolveAlertConfig({ DEEP_ALERT_MODE: "on" }).mode, "dry_run");
    assert.equal(resolveAlertConfig({ DEEP_ALERT_MODE: "" }).mode, "dry_run");
    assert.equal(resolveAlertConfig({ DEEP_ALERT_MODE: " live " }).mode, "live");
    assert.equal(resolveAlertConfig({ DEEP_ALERT_MODE: "off" }).mode, "off");
    // 공통 웹훅이 있어도 허용 목록이 비면 아무 워크스페이스에도 웹훅이 붙지 않는다
    assert.deepEqual(resolveAlertConfig({ DEEP_ALERT_WEBHOOK_URL: COMMON_HOOK }).webhookByWorkspace, {});
});

test("워크스페이스 번호는 양의 정수만, 중복 없이 읽는다 (B18)", () => {
    const cfg = resolveAlertConfig({ DEEP_ALERT_WORKSPACE_IDS: " 8, 9,x,-1,0,3.5,,8, 14 " });
    assert.deepEqual(cfg.workspaceIds, [8, 9, 14]);
});

test("워크스페이스별 웹훅이 공통 웹훅보다 우선이다 (B18)", () => {
    const cfg = resolveAlertConfig({
        DEEP_ALERT_MODE: "live",
        DEEP_ALERT_WORKSPACE_IDS: "8,9",
        DEEP_ALERT_WEBHOOK_URL: ` ${COMMON_HOOK} `,
        DEEP_ALERT_WEBHOOK_URL_9: BOL_HOOK,
        DEEP_ALERT_WEBHOOK_URL_14: BOL_HOOK,
    });
    assert.deepEqual(cfg.webhookByWorkspace, { 8: COMMON_HOOK, 9: BOL_HOOK });
});

test("https가 아닌 웹훅은 넣지 않고, 워크스페이스별 값이 잘못돼도 공통으로 새지 않는다 (B18)", () => {
    const cfg = resolveAlertConfig({
        DEEP_ALERT_WORKSPACE_IDS: "8,9",
        DEEP_ALERT_WEBHOOK_URL: COMMON_HOOK.replace("https://", "http://"),
        DEEP_ALERT_WEBHOOK_URL_9: "chat.example.test/v1/spaces/BOL",
    });
    assert.deepEqual(cfg.webhookByWorkspace, {});

    const fallback = resolveAlertConfig({ DEEP_ALERT_WORKSPACE_IDS: "9", DEEP_ALERT_WEBHOOK_URL: COMMON_HOOK, DEEP_ALERT_WEBHOOK_URL_9: "  " });
    assert.deepEqual(fallback.webhookByWorkspace, { 9: COMMON_HOOK });
});
