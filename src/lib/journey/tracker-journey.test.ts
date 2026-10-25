import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv, installFakeDb } from "../auth-fake-db.test-helper";
import { buildTrackerLabelMaps } from "./tracker-label-maps";
import type { JourneyEvent, JourneySummary } from "@/components/journey/types";

test("UX-215/279: 한 페이지의 클릭·섹션은 페이지 수·재방문 제안에서 제외하고 별칭은 유지", async (t) => {
    isolateEnv(t);
    const { normalizeTrackerEvents, buildNextActions } = await import("./tracker-journey");
    const session = { id: 1, startedAt: new Date("2026-10-25T00:00:00+09:00"), duration: 30, referrer: null, landingPage: "https://example.test/pricing" };
    const event = (id: number, eventType: string, eventName: string | null) => ({ id, sessionId: 1, occurredAt: session.startedAt, eventType, eventName, pageTitle: "요금제", pageUrl: session.landingPage, properties: null });
    const maps = buildTrackerLabelMaps([{ stages: [{ key: "stage", label: "퍼널 우선", match: { type: "custom_event", eventName: "done" } }] }], [
        { eventType: "CLICK", eventName: "cta", label: "문의 버튼" },
        { eventType: "SECTION_VIEW", eventName: "hero", label: "요금제 안내" },
        { eventType: "CUSTOM", eventName: "done", label: "별칭" },
    ]);
    const raw = [event(1, "PAGE_VIEW", null), ...Array.from({ length: 10 }, (_, i) => event(i + 2, i % 2 ? "CLICK" : "SECTION_VIEW", i % 2 ? "cta" : "hero")), event(12, "CUSTOM", "done")];
    const events = normalizeTrackerEvents([session] as Parameters<typeof normalizeTrackerEvents>[0], raw as Parameters<typeof normalizeTrackerEvents>[1], maps);
    const visit = events.find(e => e.type === "session")!;
    assert.match(visit.label, /1페이지$/);
    assert.equal(visit.children?.length, 11);
    assert.equal(visit.children?.find(e => e.type === "CLICK")?.label, "문의 버튼");
    assert.equal(visit.children?.find(e => e.type === "SECTION_VIEW")?.label, "요금제 안내");
    assert.equal(events.find(e => e.type === "CUSTOM")?.label, "퍼널 우선");
    const summary = { currentStage: null, inactivity: { isStale: false } } as JourneySummary;
    assert.equal(buildNextActions(events, summary).some(a => a.reason.includes("요금제")), false);
    visit.children!.push({ ...visit.children![0] });
    assert.equal(buildNextActions(events, summary).find(a => a.reason.includes("요금제"))?.reason, "요금제 페이지 2회 방문");
});

test("UX-280: 전환 뒤 방문은 경로에 보존하되 마지막 기여 접점에서는 제외", async (t) => {
    isolateEnv(t);
    const { buildAttribution } = await import("./tracker-journey");
    const visit = (at: string, channel: string): JourneyEvent => ({ at, source: "tracker", channel: "사이트", type: "session", label: "방문", meta: { inflowChannel: channel } });
    const events = [visit("2026-10-25T12:00:00Z", "직접"), visit("2026-10-25T00:00:00Z", "네이버")];
    const converted = buildAttribution(events, "2026-10-25T06:00:00Z");
    assert.equal(converted.firstTouch?.channel, "네이버");
    assert.equal(converted.lastTouch?.channel, "네이버");
    assert.equal(converted.path.length, 2);
    assert.equal(buildAttribution(events, null).conversionAt, null);
    assert.equal(buildAttribution(events, null).lastTouch?.channel, "직접");
    assert.equal(buildAttribution(events, "2026-10-24T00:00:00Z").lastTouch, null);
});

test("UX-217/281/282: 기간 경계 세션·실패 메일·사용자 단계 필드를 실제 여정 조립에서 함께 검증", async (t) => {
    isolateEnv(t);
    const { db } = await import("@/lib/db");
    const { buildRecordJourney } = await import("../tracker/journey");
    const at = (day: number, time = "00:00:00") => new Date(`2026-10-${day}T${time}+09:00`);
    const record = { id: 1, orgId: "org", partitionId: 2, workspaceId: 3, data: { progress: "계약" } };
    installFakeDb(t, db, (call) => {
        assert.equal(call.op, "select", "읽기 전용 조립");
        if (call.table === "records") return [record];
        if (call.table === "record_events") return [
            { type: "progress", label: "상담", occurredAt: at(24), meta: {} },
            { type: "progress", label: "계약", occurredAt: at(25, "09:00:00"), meta: {} },
        ];
        if (call.table === "tracker_visitors") return [{ id: 1 }];
        if (call.table === "tracker_sessions") return [{ id: 1, siteId: 1, startedAt: at(24, "23:59:00"), duration: 120, referrer: null, landingPage: "https://example.test/" }];
        if (call.table === "tracker_events") return [
            { id: 1, sessionId: 1, eventType: "PAGE_VIEW", eventName: null, pageTitle: "이전", pageUrl: "https://example.test/", occurredAt: at(24, "23:59:00") },
            { id: 2, sessionId: 1, eventType: "PAGE_VIEW", eventName: null, pageTitle: "오늘", pageUrl: "https://example.test/pricing", occurredAt: at(25) },
            { id: 3, sessionId: 1, eventType: "CLICK", eventName: "cta", pageUrl: "https://example.test/pricing", occurredAt: at(26) },
        ];
        if (call.table === "email_send_logs") return [
            { id: 1, status: "sent", subject: "이전", sentAt: at(24) },
            ...["sent", "failed", "pending", "rejected"].map((status, i) => ({ id: i + 2, status, subject: status, sentAt: at(25) })),
        ];
        if (call.table === "email_click_logs") return [{ clickedAt: at(25, "08:59:00"), url: "https://example.test/" }];
        if (call.table === "partitions") return [{ fieldTypeId: 5 }];
        if (call.table === "field_definitions") return [{ key: "progress", label: "진행 상태", options: ["상담", "계약"] }];
        return [];
    });
    const args = { orgId: "org", recordId: 1, merge: false, channelFilter: ["business", "tracker", "email"], fromTs: at(25).getTime(), toTs: at(25, "23:59:59").getTime() };
    const journey = (await buildRecordJourney(args))!;
    assert.deepEqual(journey.summary.density, { visits: 1, sessions: 1, emailSent: 1, emailClicks: 1, emailClickRate: 1, avgDwellSec: 60 });
    assert.deepEqual(journey.summary.reachedStages, ["계약"]);
    assert.equal(journey.summary.convertedAt, at(25, "09:00:00").toISOString());
    assert.equal(journey.events.find(e => e.type === "progress")?.channel, "진행 상태");
    assert.equal(journey.events.find(e => e.type === "session")?.children?.length, 1);
    assert.match(journey.events.find(e => e.type === "email_failed")!.label, /메일 발송 실패/);
    assert.equal(journey.attribution.path.filter(touch => touch.channel === "메일").length, 2);
    const empty = (await buildRecordJourney({ ...args, fromTs: at(27).getTime(), toTs: at(28).getTime() }))!;
    assert.equal(empty.events.length, 0);
    assert.equal(empty.summary.density.sessions, 0);
    assert.equal(empty.summary.density.emailSent, 0);
    assert.equal(empty.summary.currentStage, null);
});
