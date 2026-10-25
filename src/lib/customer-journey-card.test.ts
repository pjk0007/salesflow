import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJourneyCard, journeyPreviewText, summarizeJourney, type JourneyCardInput } from "./customer-journey-card";
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

test("CRM 전화 형식과 연락처 텍스트 칸의 번호를 카드·요약·미리보기에 표시하고 중복 번호는 합친다", () => {
    const f = fixture();
    f.fields.push(
        { key: "phone", label: "휴대폰", fieldType: "phone", value: "010-1234-5678" },
        { key: "contactPhone", label: "담당자 연락처", fieldType: "text", value: "010 1234 5678" },
        { key: "officePhone", label: "회사 전화", fieldType: "text", value: "02-123-4567" },
        { key: "international", label: "해외 전화", fieldType: "phone", value: "+1 (415) 555-0123" },
        { key: "memo", label: "연락처 메모", fieldType: "text", value: "오후에 통화 가능" },
        { key: "account", label: "계좌", fieldType: "text", value: "12345678901" },
    );
    const phones = ["010-1234-5678", "02-123-4567", "+1 (415) 555-0123"];
    assert.deepEqual(summarizeJourney(f, at(1000)).phones, phones);
    const card = buildJourneyCard(f, at(1000));
    assert.ok(card.text.includes(`연락처: ${phones.join(" · ")}`));
    assert.match(JSON.stringify(card.cardsV2), /<b>연락처: 010-1234-5678/);
    assert.ok(journeyPreviewText(f, at(1000)).includes(phones.join(" · ")));
    assert.doesNotMatch(JSON.stringify(card), /오후에 통화 가능|12345678901/);
});

test("연락처가 없거나 전화 칸 값이 번호가 아니면 빈 항목 대신 등록 없음으로 표시한다", () => {
    const f = fixture();
    f.fields.push(
        { key: "phone", label: "전화", fieldType: "phone", value: "전화 연결 대기" },
        { key: "mobile", label: "휴대폰", fieldType: "phone", value: "<script>01012345678</script>" },
        { key: "short", label: "전화", fieldType: "phone", value: "1234" },
    );
    assert.deepEqual(summarizeJourney(f, at(1000)).phones, []);
    const card = buildJourneyCard(f, at(1000));
    assert.match(card.text, /연락처: CRM에 등록된 연락처 없음/);
    assert.match(JSON.stringify(card.cardsV2), /연락처: CRM에 등록된 연락처 없음/);
    assert.match(journeyPreviewText(f, at(1000)), /연락처: CRM에 등록된 연락처 없음/);
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

test("한 페이지 30초 방문은 CRM 판정을 보존하지만 구글챗 발송에서 제외한다", () => {
    const f = fixture();
    f.events = f.events.slice(0, 1);
    f.session = { ...f.session, pageCount: 1, duration: 30, endedAt: at(30) };
    const s = summarizeJourney(f, at(1000));
    assert.equal(s.eligible, true);
    assert.equal(s.chatEligible, false);
    assert.equal(s.chatSuppressionReason, "60초 미만 방문: 구글챗 발송 제외");
    assert.equal(s.stage, "둘러봄");
});

test("구글챗은 실제 측정 체류 60초 이상만 발송하고 핵심 ICP도 같은 기준을 쓴다", () => {
    for (const seconds of [5, 59, 59.999, 60, 61]) {
        const f = fixture();
        f.session = { ...f.session, duration: Math.round(seconds), endedAt: at(seconds), pageCount: 1 };
        f.fields.push({ key: "icp", label: "ICP", fieldType: "text", value: "핵심" });
        f.events = [f.events[0], { ...f.events[4], occurredAt: at(1) }];
        const s = summarizeJourney(f, at(1000));
        assert.equal(s.eligible, true);
        assert.equal(s.chatEligible, seconds >= 60, `${seconds}초`);
        assert.equal(s.totalSeconds, seconds);
    }
});

test("구글챗은 종료 시각으로 60초를 확인할 수 있으나 측정 불명·미래·역전 시각은 제외한다", () => {
    const f = fixture();
    f.events = [f.events[0]];
    f.session.duration = null;
    f.session.endedAt = at(60);
    assert.equal(summarizeJourney(f, at(1000)).chatEligible, true);
    f.session.endedAt = null;
    const unknown = summarizeJourney(f, at(1000));
    assert.equal(unknown.chatEligible, false);
    assert.equal(unknown.chatSuppressionReason, "체류시간 미확인: 구글챗 발송 제외");
    f.session.duration = 120;
    for (const end of [at(-1), at(2000)]) {
        f.session.endedAt = end;
        assert.equal(summarizeJourney(f, at(1000)).chatEligible, false);
    }
});

test("발송 직후 1초짜리 방문은 카드 대상에서 제외한다", () => {
    const f = fixture();
    f.sentAt = at(-10); f.clickedAt = at(-1);
    f.events = f.events.slice(0, 1);
    f.session = { ...f.session, duration: 1, endedAt: at(1), pageCount: 1 };
    assert.equal(summarizeJourney(f, at(1000)).eligible, false);
});

test("버튼·영역 이벤트와 핵심 ICP가 있어도 총 체류 3초 미만은 카드·순위에서 제외한다", () => {
    for (const seconds of [0, 1, 2.99, 3]) {
        const f = fixture();
        f.session = { ...f.session, duration: seconds, endedAt: at(seconds), pageCount: 1 };
        f.fields.push({ key: "icp", label: "ICP", fieldType: "text", value: "핵심" });
        f.events = [f.events[0], { ...f.events[2], occurredAt: at(seconds), properties: { dwell_ms: seconds * 1000 } },
            { ...f.events[4], occurredAt: at(seconds) }];
        const s = summarizeJourney(f, at(1000));
        assert.equal(s.eligible, seconds >= 3, `${seconds}초 방문`);
        assert.equal(s.priority.rankEligible, seconds >= 3, `${seconds}초 순위`);
        if (seconds < 3) {
            assert.equal(s.priority.score, 0);
            assert.equal(s.priority.tier, "normal");
            assert.equal(s.priority.excludedReason, "3초 미만 짧은 방문");
        }
    }
});

test("duration이 없으면 종료 시각으로 짧은 방문을 판정하고 측정 없음은 0초로 간주하지 않는다", () => {
    const f = fixture();
    f.events = [f.events[0], { ...f.events[4], occurredAt: at(1) }];
    f.session = { ...f.session, duration: null, endedAt: at(1), pageCount: 1 };
    const measured = summarizeJourney(f, at(1000));
    assert.equal(measured.totalSeconds, 1);
    assert.equal(measured.eligible, false);
    assert.equal(measured.priority.rankEligible, false);
    f.session.endedAt = null;
    const unknown = summarizeJourney(f, at(1000));
    assert.equal(unknown.totalSeconds, null);
    assert.equal(unknown.eligible, true);
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

test("카드는 저장한 판정·현재 처리 상태·관리 링크를 표시하고 대응 메모는 챗에 넣지 않는다", () => {
    const f = fixture();
    const assessed = { ...summarizeJourney(f, at(1000)).priority, tier: "urgent" as const, score: 75, evidence: ["저장된 상위 리드 근거"] };
    const card = buildJourneyCard(f, at(1000), { ownerName: "이효정", state: "handled" }, {
        status: "planned", dueAt: at(90000).toISOString(), note: "챗에 보내지 않을 대응 메모", revision: 1,
        updatedAt: at(500).toISOString(), updatedBy: "가상 담당자", lastRemindedAt: null, reminderCount: 0,
    }, assessed);
    assert.match(card.text, /🔴 핵심 리드/);
    assert.match(JSON.stringify(card), /저장된 상위 리드 근거/);
    assert.match(JSON.stringify(card), /연락 예정/);
    assert.match(JSON.stringify(card), /journey#lead-followup/);
    assert.doesNotMatch(JSON.stringify(card), /챗에 보내지 않을 대응 메모/);
});

test("cardsV2 전송은 기존 스레드·고정 메시지 ID·429 재시도를 함께 쓴다", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const post: typeof fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(calls.length === 1 ? '{"error":{"message":"잠시 후"}}' : "{}", { status: calls.length === 1 ? 429 : 200 });
    };
    const message = buildJourneyCard(fixture(), at(1000));
    const result = await postGoogleChatMessage("https://chat.googleapis.com/v1/spaces/demo/messages?key=fake&token=fake", message, post,
        { spaceIntervalMs: 0, retryDelayMs: 0, threadKey: "record-42", messageId: "client-journey-42" });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body.cardsV2, message.cardsV2);
    assert.deepEqual(calls[0].body.thread, { threadKey: "record-42" });
    assert.match(calls[0].url, /messageId=client-journey-42/);
    assert.doesNotMatch(calls[0].url, /requestId=/);
});
