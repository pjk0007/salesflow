import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../auth-fake-db.test-helper";
import type { CandidateRow } from "../customer-journey-source";

test("고객여정 조회 결과의 발신 도메인·봇 판정·시각 검증을 카드와 미리보기에 전달", async t => {
    isolateEnv(t);
    const { cardInput } = await import("../customer-journey-source");
    const { buildJourneyCard, journeyPreviewText } = await import("../customer-journey-card");
    const now = new Date("2026-11-04T09:00:00Z");
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    const row: CandidateRow = { send_log_id: 1, org_id: "00000000-0000-4000-8000-000000000001", workspace_id: 8,
        business_name: "가상 사업", record_id: 1, integrated_code: null, data: {}, recipient_email: "fixture@example.test",
        subject: "가상 제목", sent_at: ago(1800), clicked_at: ago(1205), sender_email: "hello@domain2.test", click_is_bot: false,
        session_id: 1, site_id: 1, visitor_id: 1, started_at: ago(1200), ended_at: ago(1100), duration: 100,
        page_count: 1, click_id: "fictional", fields: [], labels: [], events: [] };
    const input = cardInput(row, "https://sendb.kr");
    assert.equal(input.acquisition?.certainty, "confirmed");
    assert.match(buildJourneyCard(input, now).text, /유입경로: 메일 · domain2.test \[확인\]/);
    assert.match(journeyPreviewText(input, now), /메일 · domain2.test \[확인\]/);
    assert.equal(cardInput({ ...row, sender_email: null }, "https://sendb.kr").acquisition?.channel, "메일 · 발신 도메인 미확인");
    for (const bad of [{ click_is_bot: true }, { click_is_bot: undefined }, { clicked_at: ago(1100) }, { sent_at: now }]) {
        assert.equal(cardInput({ ...row, ...bad }, "https://sendb.kr").acquisition?.certainty, "unknown");
    }
});
