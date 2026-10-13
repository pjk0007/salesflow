import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJourneyCard, summarizeJourney, type JourneyCardInput } from "./customer-journey-card";
import { isCoreIcp, journeyPercentile, type JourneyAudience } from "./customer-journey-priority";
import { isJourneyInternalEmail, summarizeJourneyAudience } from "./customer-journey-audience";
import { journeyOwner } from "./customer-journey-owner";
import { postGoogleChatMessage } from "./google-chat";

const start = new Date("2026-10-12T01:00:00Z");
const at = (sec: number) => new Date(start.getTime() + sec * 1000);
const audience = (): JourneyAudience => ({ internal: false, sharedVisitor: false, existingVisitor: false, alreadyConverted: false,
    unsubscribed: false, revisit: false, lastActivityAt: at(195) });
export function priorityFixture(): JourneyCardInput {
    const f: JourneyCardInput = { recordId: 42, integratedCode: null, businessName: "디하", recipientEmail: "fixture@example.test",
        subject: "가상 메일", sentAt: at(-600), clickedAt: at(-4), baseUrl: "https://sendb.kr", fields: [], labels: {}, audience: audience(),
        session: { id: 52, siteId: 2, visitorId: 12, startedAt: start, endedAt: at(195), duration: 195, pageCount: 3, clickId: "fixture" },
        events: [] };
    f.events = [
        { sessionId: 52, eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://site.test/", pageTitle: "서비스 소개", occurredAt: at(0), properties: null },
        { sessionId: 52, eventType: "SECTION_VIEW", eventName: "trust-cases", pageUrl: "https://site.test/", pageTitle: null, occurredAt: at(30), properties: { dwell_ms: 20_000 } },
        { sessionId: 52, eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://site.test/pricing", pageTitle: "요금", occurredAt: at(45), properties: null },
        { sessionId: 52, eventType: "SECTION_VIEW", eventName: "faq", pageUrl: "https://site.test/pricing", pageTitle: null, occurredAt: at(110), properties: { dwell_ms: 20_000 } },
        { sessionId: 52, eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://site.test/signup", pageTitle: "신청", occurredAt: at(125), properties: null },
        { sessionId: 52, eventType: "CUSTOM", eventName: "subscribe_step_1", pageUrl: "https://site.test/signup", pageTitle: null, occurredAt: at(130), properties: null },
    ];
    return f;
}
test("ICP 표시 없이도 실제 신청 시작·3가지 검토·지속 활동이면 엄격한 고정 기준의 핵심 리드", () => {
    const s = summarizeJourney(priorityFixture(), at(1000));
    assert.equal(s.priority.score, 85); assert.equal(s.priority.tier, "urgent"); assert.equal(s.priority.coreIcp, false);
    const card = buildJourneyCard(priorityFixture(), at(1000), { ownerName: "이효정", state: "tag" });
    assert.match(card.text, /^🔴/); assert.match(JSON.stringify(card), /이효정/); assert.doesNotMatch(card.text, /<users/);
});
test("표본이 적을 때 75점은 강조, 같은 사업 20명 이상 중 상위 5%일 때 담당자 요청", () => {
    const f = priorityFixture(); f.events = f.events.filter((e) => e.eventName !== "faq");
    assert.equal(summarizeJourney(f, at(1000)).priority.tier, "highlight");
    f.cohort = Array.from({ length: 19 }, (_, i) => ({ customerKey: `fixture-${i}`, score: i * 2 }));
    const s = summarizeJourney(f, at(1000));
    assert.equal(s.priority.score, 75); assert.equal(s.priority.percentile, 100); assert.equal(s.priority.tier, "urgent");
    f.cohort = Array.from({ length: 19 }, (_, i) => ({ customerKey: `fixture-${i}`, score: 85 }));
    assert.equal(summarizeJourney(f, at(1000)).priority.tier, "highlight");
});
test("동점·같은 고객 중복 방문을 이용해 상위 순위를 부풀리지 않는다", () => {
    assert.deepEqual(journeyPercentile("self", 75, Array.from({ length: 100 }, () => ({ customerKey: "same", score: 0 }))), { percentile: null, cohortSize: 2 });
    assert.equal(journeyPercentile("self", 75, Array.from({ length: 19 }, (_, i) => ({ customerKey: String(i), score: 75 }))).percentile, 0);
});
test("탭을 오래 열어 둠·신청 페이지 조회·소개서 다운로드만으로 담당자를 태그하지 않는다", () => {
    for (const name of [null, "nav-brochure", "subscribe_step_1"]) {
        const f = priorityFixture(); f.events = f.events.filter((e) => e.eventType === "PAGE_VIEW");
        if (name) f.events.push({ ...priorityFixture().events[5], eventName: name });
        f.session.duration = 20_000; f.session.endedAt = at(195);
        assert.notEqual(summarizeJourney(f, at(1000)).priority.tier, "urgent");
    }
    const f = priorityFixture(); f.events = [f.events[0]];
    assert.equal(summarizeJourney(f, at(1000)).priority.tier, "normal");
    const idle = priorityFixture();
    idle.events = idle.events.map((e, i) => ({ ...e, occurredAt: at(i * 8) }));
    assert.notEqual(summarizeJourney(idle, at(1000)).priority.tier, "urgent");
});
test("가격 스크롤 통과·같은 영역 중복 이벤트·미래/다른 세션 신호는 긴급도를 올리지 않는다", () => {
    const f = priorityFixture(); f.events = f.events.filter((e) => e.eventName === "subscribe_step_1" || e.eventName === "trust-cases");
    f.events.push(...Array.from({ length: 20 }, () => ({ ...f.events[0] })),
        { ...f.events[0], eventName: "faq", sessionId: 999 }, { ...f.events[0], eventName: "faq", occurredAt: at(2000) },
        { ...f.events[0], eventType: "SECTION_VIEW", eventName: "service-pricing", properties: { dwell_ms: 100 } });
    assert.notEqual(summarizeJourney(f, at(1000)).priority.tier, "urgent");
});
test("핵심 ICP는 명시적 분류만 보조로 쓴다. 비핵심·미확인·상충된 값은 핵심으로 보지 않는다", () => {
    assert.equal(isCoreIcp([{ key: "icp", label: "ICP", value: "핵심" }]), true);
    for (const value of ["비핵심", "핵심 아님", "아마 핵심일 듯", "", "core?", "B"]) assert.equal(isCoreIcp([{ key: "icp", label: "ICP", value }]), false);
    assert.equal(isCoreIcp([{ key: "icp", label: "ICP", value: "core" }, { key: "icp_tier", label: "ICP 등급", value: "B" }]), false);
    const f = priorityFixture(); f.events = [f.events[0]]; f.fields.push({ key: "icp", label: "ICP", fieldType: "text", value: "핵심" });
    assert.equal(summarizeJourney(f, at(1000)).priority.tier, "highlight");
});
test("내부·공유 브라우저·반복 기존 방문·수신거부·완료는 순위 집계와 긴급 태그에서 제외", () => {
    for (const flag of ["internal", "sharedVisitor", "existingVisitor", "unsubscribed", "alreadyConverted"] as const) {
        const f = priorityFixture(); f.audience![flag] = true;
        const s = summarizeJourney(f, at(1000));
        assert.equal(s.priority.score, 0); assert.equal(s.priority.tier, "normal"); assert.equal(s.priority.rankEligible, false);
        if (flag !== "alreadyConverted") assert.equal(s.eligible, false);
        else assert.equal(s.completed, true);
    }
    const f = priorityFixture(); f.events.push({ ...f.events[5], eventName: "signup_complete", occurredAt: at(180) });
    assert.equal(summarizeJourney(f, at(1000)).priority.tier, "normal");
});
test("내부 도메인은 정확한 경계로, 조직 구성원·발신 주소는 정확한 이메일로 제외", () => {
    for (const e of ["CEO@matchesplan.com", "a@matchesplan.cloud", "a@dev.matchesplan.com", "personal@gmail.test"]) {
        assert.equal(isJourneyInternalEmail(e, ["personal@gmail.test"]), true);
    }
    for (const e of ["client@gmail.test", "a@notmatchesplan.com", "a@matchesplan.com.evil.test"]) assert.equal(isJourneyInternalEmail(e, ["personal@gmail.test"]), false);
    assert.equal(isJourneyInternalEmail("a@extra.test", [], ["extra.test"]), true);
});
test("같은 고객의 과거 메일 재방문과 사내 테스트 패턴을 구별하고 identify의 내부 이메일도 제외", () => {
    const f = priorityFixture();
    const facts: Parameters<typeof summarizeJourneyAudience>[0] = { authorized: true, internalEmails: [], identifiedEmails: [],
        links: [{ recordId: 42, email: f.recipientEmail, clickId: "old" }],
        sessions: [1, 2, 3].map((id) => ({ ...f.session, id, startedAt: at(-10_000 + id * 1000), clickId: "old" })),
        relatedRecords: [], funnelStages: [], recordEvents: [], completionEvents: [], unsubscribed: false, lastActivityAt: at(195).toISOString() };
    const target = { recordId: 42, recipientEmail: f.recipientEmail, sentAt: f.sentAt, session: f.session };
    assert.equal(summarizeJourneyAudience(facts, target, at(1000)).existingVisitor, false);
    assert.equal(summarizeJourneyAudience(facts, target, at(1000)).revisit, true);
    facts.links = []; assert.equal(summarizeJourneyAudience(facts, target, at(1000)).existingVisitor, true);
    facts.identifiedEmails = ["coo@matchesplan.com"];
    assert.equal(summarizeJourneyAudience(facts, target, at(1000)).internal, true);
});
test("담당자 라우팅은 승인한 두 스페이스의 실제 사용자 ID에만 연결된다", () => {
    const hook = (space: string) => `https://chat.googleapis.com/v1/spaces/${space}/messages?key=fake&token=fake`;
    assert.deepEqual(journeyOwner(hook("AAQASH-gyo4")), { name: "이효정", userId: "110605666755540583322" });
    assert.deepEqual(journeyOwner(hook("AAQAbqhHk2A")), { name: "양윤지", userId: "101302053528103792273" });
    for (const s of ["unknown", "__proto__", "constructor"]) assert.equal(journeyOwner(hook(s)), undefined);
    assert.equal(journeyOwner("https://evil.test/v1/spaces/AAQASH-gyo4/messages"), undefined);
});
test("본문의 전체/개별 멘션은 차단하고 검증한 담당자 한 명만 별도로 태그한다. 저장 메타데이터는 전송하지 않는다", async () => {
    let body: { text: string; journeyPriority?: unknown } | undefined;
    const fake: typeof fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response("{}"); };
    const result = await postGoogleChatMessage("https://chat.googleapis.com/v1/spaces/fixture/messages?key=fake&token=fake",
        { text: "고객 메모 <users/all> <users/123456789>" , journeyPriority: { tier: "urgent" } } as { text: string }, fake,
        { spaceIntervalMs: 0, mentionUserId: "110605666755540583322" });
    assert.equal(result.ok, true); assert.equal(body!.journeyPriority, undefined);
    assert.equal(body!.text.match(/<users\//g)?.length, 1);
    assert.match(body!.text, /<users\/110605666755540583322>/);
    assert.doesNotMatch(body!.text, /<users\/all>/);
});
test("이메일 별칭·전체·임의 문자열을 담당자 ID로 지정하면 외부 요청 전에 거절한다", async () => {
    let calls = 0;
    const fake: typeof fetch = async () => { calls++; return new Response("{}"); };
    for (const id of ["all", "senior_hj@matchesplan.com", "123> <users/all", "", "-1"]) {
        assert.equal((await postGoogleChatMessage("https://chat.googleapis.com/v1/spaces/fixture/messages?key=fake&token=fake", { text: "test" }, fake,
            { spaceIntervalMs: 0, mentionUserId: id })).ok, false);
    }
    assert.equal(calls, 0);
});
