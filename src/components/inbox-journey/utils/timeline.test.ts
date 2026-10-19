import { test } from "node:test";
import assert from "node:assert/strict";
import { customerTimeline } from "./timeline";
import type { JourneyEvent } from "@/components/journey/types";

test("상담 원문을 상담별 시작·최근 진행으로 묶고 이전 메일·방문·CRM 경로는 보존한다", () => {
    const event = (at: string, source: JourneyEvent["source"], type: string, label: string, meta = {}): JourneyEvent => ({ at, source, type, label, channel: source, meta });
    const source = [
        event("2026-10-18T01:00:00Z", "email", "email_sent", "첫 메일"),
        event("2026-10-18T02:00:00Z", "tracker", "session", "가격 페이지 방문"),
        event("2026-10-19T01:00:00Z", "inbox", "chat_customer", "원문 비공개", { conversationId: "a", body: "원문 비공개" }),
        event("2026-10-19T01:01:00Z", "inbox", "chat_reply", "원문 답변", { conversationId: "a" }),
        event("2026-10-19T01:02:00Z", "business", "crm_deal_updated", "검토 단계"),
        event("2026-10-19T01:03:00Z", "inbox", "chat_customer", "다른 상담", { conversationId: "b" }),
    ];
    const rows = customerTimeline(source.reverse());
    assert.equal(rows.length, 6);
    assert.equal(rows[0].label, "첫 메일");
    assert.equal(rows.filter(row => row.type === "conversation_started").length, 2);
    assert.equal(rows.find(row => row.type === "conversation_last_activity")!.meta.questions, 1);
    assert.equal(rows.find(row => row.type === "conversation_last_activity")!.meta.replies, 1);
    assert.ok(!JSON.stringify(rows).includes("원문 비공개"));
    assert.equal(source.length, 6);
});

test("20건 이전의 경로와 방문 하위 페이지도 자르지 않는다", () => {
    const events: JourneyEvent[] = Array.from({ length: 60 }, (_, i) => ({ at: new Date(1792300000000 + i * 1000).toISOString(), source: "business", channel: "고객", type: "signup", label: `이전 활동 ${i}`, meta: {} }));
    events[0].children = [{ ...events[1], label: "서비스 페이지" }];
    const rows = customerTimeline(events);
    assert.equal(rows.length, 60);
    assert.equal(rows[0].children![0].label, "서비스 페이지");
});
