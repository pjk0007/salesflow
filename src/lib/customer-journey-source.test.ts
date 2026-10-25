import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "./auth-fake-db.test-helper";

// UX-216 — 여정 후보의 CRM 필드가 resolved-fields(파티션 타입 → 기본 타입 → 직속)와 같은지 실제 SQL(메모리 PGlite)로 확인.
// 마이그레이션은 적용하지 않고 drizzle 정의로 빈 표만 만든다.
const ORG = "00000000-0000-4000-8000-0000000000cc";
const NOW = new Date("2026-10-25T03:00:00Z");

async function setup(t: Parameters<typeof isolateEnv>[0], typing: { partitionType: number | null; defaultType: number | null }) {
    isolateEnv(t);
    const { openPglite, pgliteTag, insertRow } = await import("./db/pglite-harness.test-helper");
    const s = await import("./db/schema");
    const { loadCandidates, cardInput } = await import("./customer-journey-source");
    const pg = await openPglite([s.workspaces, s.trackerSites, s.trackerSessions, s.emailClickLogs, s.emailSendLogs, s.records,
        s.partitions, s.fieldDefinitions, s.trackerEventAliases, s.trackerEvents, s.customerJourneyAlerts]);
    t.after(() => pg.close());
    await insertRow(pg, "workspaces", { id: 1, org_id: ORG, name: "가상 사업", default_field_type_id: typing.defaultType });
    await insertRow(pg, "partitions", { id: 5, workspace_id: 1, name: "리드", field_type_id: typing.partitionType });
    // 타입 10(파티션 타입) · 타입 20(기본 타입) · 워크스페이스 직속(이전 필드, 같은 key 라벨 충돌·ICP 포함)
    const defs: Array<Record<string, unknown>> = [
        { id: 1, field_type_id: 10, key: "company", label: "회사명", field_type: "text", sort_order: 1 },
        { id: 2, field_type_id: 10, key: "contactName", label: "담당자", field_type: "text", sort_order: 2 },
        { id: 3, field_type_id: 20, key: "company", label: "기본 회사", field_type: "text", sort_order: 1 },
        { id: 4, workspace_id: 1, key: "company", label: "회사(이전)", field_type: "text", sort_order: 0 },
        { id: 5, workspace_id: 1, key: "icp", label: "ICP 등급", field_type: "text", sort_order: 3 },
    ];
    for (const d of defs) await insertRow(pg, "field_definitions", d);
    await insertRow(pg, "records", { id: 42, org_id: ORG, workspace_id: 1, partition_id: 5,
        data: JSON.stringify({ company: "예시컴퍼니 (가상)", contactName: "김담당 (가상)", icp: "핵심" }) });
    await insertRow(pg, "tracker_sites", { id: 2, org_id: ORG, workspace_id: 1, name: "사이트", api_key: "fake-key", is_active: 1 });
    await insertRow(pg, "email_send_logs", { id: 70, org_id: ORG, record_id: 42, recipient_email: "demo@example.test", status: "sent", sent_at: "2026-10-25T01:00:00Z" });
    await insertRow(pg, "email_click_logs", { id: 80, org_id: ORG, send_log_id: 70, url: "https://site.test/", click_id: "clk_1", clicked_at: "2026-10-25T01:10:00Z", is_bot: false });
    await insertRow(pg, "tracker_sessions", { id: 300, site_id: 2, visitor_id: 9, session_key: "s1", click_id: "clk_1",
        started_at: "2026-10-25T01:11:00Z", ended_at: "2026-10-25T01:15:00Z", duration: 240, page_count: 2 });
    const conn = pgliteTag(pg) as never;
    const rows = await loadCandidates(conn, 1, NOW, new Date("2026-10-20T00:00:00Z"), { sessionId: 300, orgId: ORG });
    assert.equal(rows.length, 1);
    return { row: rows[0], input: cardInput(rows[0], "https://sendb.kr") };
}

test("UX-216 파티션 타입이 있으면 그 타입 필드만 — 이전 직속 필드(같은 key 라벨·ICP)가 섞이지 않는다", async (t) => {
    const { row, input } = await setup(t, { partitionType: 10, defaultType: 20 });
    assert.deepEqual(row.fields.map((f) => f.label), ["회사명", "담당자"]);
    assert.deepEqual(input.fields.map((f) => [f.label, f.value]), [["회사명", "예시컴퍼니 (가상)"], ["담당자", "김담당 (가상)"]]);
    assert.ok(!input.fields.some((f) => f.key === "icp"), "현재 CRM에 없는 ICP 근거가 섞이지 않는다");
});

test("UX-216 파티션 타입이 없으면 워크스페이스 기본 타입만", async (t) => {
    const { row } = await setup(t, { partitionType: null, defaultType: 20 });
    assert.deepEqual(row.fields.map((f) => f.label), ["기본 회사"]);
});

test("UX-216 타입이 하나도 없으면 기존처럼 워크스페이스 직속 필드로 폴백", async (t) => {
    const { row } = await setup(t, { partitionType: null, defaultType: null });
    assert.deepEqual(row.fields.map((f) => f.label), ["회사(이전)", "ICP 등급"]);
});
