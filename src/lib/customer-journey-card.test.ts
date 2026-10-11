import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJourneyCard, summarizeJourney, type JourneyCardInput } from "./customer-journey-card";
import { postGoogleChatMessage } from "./google-chat";

const start = new Date("2026-10-11T05:00:00Z");
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
export function fixture(): JourneyCardInput {
    return {
        recordId: 42, integratedCode: "DEMO-42", businessName: "디자이너하이어", recipientEmail: "demo@example.test",
        subject: "디자인 운영을 어떻게 하고 계신가요?", sentAt: at(-600), clickedAt: at(-4),
        session: { id: 52, siteId: 2, visitorId: 12, startedAt: start, endedAt: at(195), duration: 195, pageCount: 3, clickId: "clk_demo" },
        fields: [{ key: "company", label: "회사명", fieldType: "text", value: "예시컴퍼니 (가상)" },
            { key: "contactName", label: "담당자", fieldType: "text", value: "김담당 (가상)" }],
        labels: { "SECTION_VIEW:service-pricing": "요금 안내", "CUSTOM:subscribe_step_1": "신청 시작" }, baseUrl: "https://sendb.kr",
        events: [
            { sessionId: 52, eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://site.test/", pageTitle: "서비스 소개", occurredAt: at(0), properties: null },
            { sessionId: 52, eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://site.test/pricing", pageTitle: "요금 안내", occurredAt: at(45), properties: null },
            { sessionId: 52, eventType: "SECTION_VIEW", eventName: "service-pricing", pageUrl: "https://site.test/pricing", pageTitle: null, occurredAt: at(100), properties: { dwell_ms: 80000 } },
            { sessionId: 52, eventType: "PAGE_VIEW", eventName: null, pageUrl: "https://site.test/signup", pageTitle: "신청서", occurredAt: at(125), properties: null },
            { sessionId: 52, eventType: "CUSTOM", eventName: "subscribe_step_1", pageUrl: "https://site.test/signup", pageTitle: null, occurredAt: at(130), properties: null },
        ],
    };
}

test("신청 시작 뒤 멈춘 방문: 회사·담당자·페이지 순서·체류를 개인 카드에 묶는다", () => {
    const s = summarizeJourney(fixture(), at(1000));
    assert.equal(s.eligible, true);
    assert.equal(s.company, "예시컴퍼니 (가상)");
    assert.equal(s.person, "김담당 (가상)");
    assert.equal(s.stage, "신청 시작");
    assert.equal(s.completed, false);
    assert.deepEqual(s.pages.map((p) => p.seconds), [45, 80, 70]);
    assert.deepEqual(s.sections, [{ label: "요금 안내", seconds: 80 }]);
    const card = JSON.stringify(buildJourneyCard(fixture(), at(1000)));
    assert.match(card, /이탈 추정/);
    assert.match(card, /records\/42\/journey/);
});

test("방문이 아직 움직이는 중이면 이탈 카드로 보내지 않는다", () => {
    assert.equal(summarizeJourney(fixture(), at(300)).eligible, false);
});

test("신청 완료 기록이 있으면 이탈로 표시하지 않는다", () => {
    const f = fixture();
    f.events.push({ ...f.events[4], eventName: "signup_complete", occurredAt: at(180) });
    const s = summarizeJourney(f, at(1000));
    assert.equal(s.completed, true);
    assert.doesNotMatch(buildJourneyCard(f, at(1000)).text, /이탈/);
    assert.match(s.recommendation, /온보딩/);
});

test("구매 완료도 완료로 표시한다", () => {
    const f = fixture();
    f.events.push({ ...f.events[4], eventType: "PURCHASE", eventName: "order", occurredAt: at(185) });
    assert.equal(summarizeJourney(f, at(1000)).completed, true);
});

test("한 페이지를 30초 본 사람도 깊이 여부와 무관하게 카드 대상이다", () => {
    const f = fixture();
    f.events = f.events.slice(0, 1);
    f.session = { ...f.session, pageCount: 1, duration: 30, endedAt: at(30) };
    const s = summarizeJourney(f, at(1000));
    assert.equal(s.eligible, true);
    assert.equal(s.stage, "둘러봄");
});

test("발송 직후 1초짜리 방문은 카드 대상에서 제외한다", () => {
    const f = fixture();
    f.sentAt = at(-10); f.clickedAt = at(-1);
    f.events = f.events.slice(0, 1);
    f.session = { ...f.session, duration: 1, endedAt: at(1), pageCount: 1 };
    assert.equal(summarizeJourney(f, at(1000)).eligible, false);
});

test("측정되지 않은 마지막 페이지 체류를 현재 시각으로 부풀리지 않는다", () => {
    const f = fixture(); f.session = { ...f.session, duration: null, endedAt: null };
    const s = summarizeJourney(f, at(86400));
    assert.equal(s.pages.at(-1)?.seconds, null);
    assert.equal(s.totalSeconds, null);
});

test("다른 세션·미래 이벤트가 이탈 단계와 체류에 섞이지 않는다", () => {
    const f = fixture();
    f.events.push({ ...f.events[4], sessionId: 999, eventName: "signup_complete" },
        { ...f.events[4], eventName: "signup_complete", occurredAt: at(2000) });
    assert.equal(summarizeJourney(f, at(1000)).completed, false);
});

test("cardsV2 전송은 기존 스레드·요청 ID·429 재시도를 함께 쓴다", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const post: typeof fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(calls.length === 1 ? '{"error":{"message":"잠시 후"}}' : "{}", { status: calls.length === 1 ? 429 : 200 });
    };
    const message = buildJourneyCard(fixture(), at(1000));
    const result = await postGoogleChatMessage("https://chat.googleapis.com/v1/spaces/demo/messages?key=fake&token=fake", message, post,
        { spaceIntervalMs: 0, retryDelayMs: 0, threadKey: "record-42", requestId: "00000000-0000-5000-a000-000000000042" });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body.cardsV2, message.cardsV2);
    assert.deepEqual(calls[0].body.thread, { threadKey: "record-42" });
    assert.match(calls[0].url, /requestId=/);
});
