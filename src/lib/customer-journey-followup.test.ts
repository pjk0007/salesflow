import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "./auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-25T03:00:00Z");
const KEY = "customer-key-1";
const ENV = {} as NodeJS.ProcessEnv;

type Responder = (text: string, params: unknown[]) => unknown[] | undefined;

/** postgres.js 태그 흉내 — SQL 글을 보고 가상 줄을 준다. 쓰기 문장이 오면 실패시킨다 (조회만 해야 한다) */
function fakeConn(respond: Responder) {
    const seen: string[] = [];
    const conn = (async (strings: TemplateStringsArray, ...params: unknown[]) => {
        const text = strings.join("?").replace(/\s+/g, " ");
        seen.push(text);
        if (/^\s*(UPDATE|INSERT|DELETE)\b/i.test(text) || /WITH changed AS/.test(text)) throw new Error(`조회 중 쓰기: ${text}`);
        return respond(text, params) ?? [];
    }) as never;
    return { conn, seen };
}

const followupRow = { data: { status: "contacted", dueAt: null, note: "통화 완료, 다음 주 견적", revision: 3,
    updatedAt: "2026-09-10T01:00:00.000Z", updatedBy: "김담당", lastRemindedAt: null, reminderCount: 0 } };
const historyRows = [
    { at: new Date("2026-09-10T01:00:00Z"), meta: { workspaceId: 7, customerKey: KEY, status: "contacted", dueAt: null, note: "통화 완료", actorName: "김담당" } },
    { at: new Date("2026-09-08T01:00:00Z"), meta: JSON.stringify({ workspaceId: 7, customerKey: KEY, status: "planned", dueAt: "2026-09-09T01:00:00Z", note: "", actorName: "이담당" }) },
];

function baseResponder(alert: Record<string, unknown> | null, opts: { followupByRecord?: boolean } = {}): Responder {
    return (text) => {
        if (text.startsWith("SELECT id FROM records")) return [{ id: 42 }];
        if (text.includes("WITH assessed")) return []; // 유효 판정 없음
        if (text.includes("FROM customer_journey_alerts WHERE org_id=? AND record_id=?")) return alert ? [alert] : [];
        if (text.includes("SELECT workspace_id,customer_key FROM journey_lead_followups")) return opts.followupByRecord === false ? [] : [{ workspace_id: 7, customer_key: KEY }];
        if (text.includes("meta->>'workspaceId' AS workspace_id")) return [{ workspace_id: "7", customer_key: KEY }];
        if (text.includes("SELECT json_build_object")) return [followupRow];
        if (text.includes("FROM record_events WHERE org_id=? AND type='lead_followup'")) return historyRows;
        return undefined;
    };
}

async function load(t: Parameters<typeof isolateEnv>[0]) {
    isolateEnv(t);
    return import("./customer-journey-followup");
}

const alertRow = (over: Record<string, unknown>) => ({ id: 9, workspace_id: 7, record_id: 42, session_id: 300, status: "sent", last_error: null,
    created_at: new Date("2026-10-20T00:00:00Z"),
    message: { journeyPriority: { version: 1, rankEligible: true, tier: "urgent", customerKey: KEY, excludedReason: null } }, ...over });

test("UX-278 판정 후 30일이 지나도 처리 상태·메모·이력을 읽기 전용으로 돌려주고 이유를 알린다", async (t) => {
    const { getLeadFollowup } = await load(t);
    const { conn } = fakeConn(baseResponder(alertRow({ created_at: new Date("2026-09-01T00:00:00Z") })));
    const detail = await getLeadFollowup(conn, ORG, 42, NOW, ENV);
    assert.equal(detail.lead, null);
    assert.equal(detail.excludedReason, "마지막 판정 후 30일이 지나 핵심 리드 판정에서 빠졌습니다.");
    assert.equal(detail.archivedFollowup?.status, "contacted");
    assert.equal(detail.archivedFollowup?.note, "통화 완료, 다음 주 견적");
    assert.deepEqual(detail.history.map((h) => [h.status, h.actorName]), [["contacted", "김담당"], ["planned", "이담당"]]);
});

test("UX-278 뒤늦게 내부·공유 등 제외 조건으로 바뀐 고객: 저장된 제외 이유를 보여 준다", async (t) => {
    const { getLeadFollowup } = await load(t);
    const excluded = alertRow({ message: { journeyPriority: { version: 1, rankEligible: false, tier: "normal", customerKey: KEY, excludedReason: "내부 계정" } } });
    const { conn } = fakeConn(baseResponder(excluded));
    const detail = await getLeadFollowup(conn, ORG, 42, NOW, ENV);
    assert.equal(detail.excludedReason, "내부 계정");
    assert.equal(detail.history.length, 2);
});

test("UX-278 기간 안 판정이지만 지금 자료로 다시 확인할 수 없으면(완료·원본 없음) 그 이유, 후속 대응 줄이 없으면 이 레코드의 이력 키로 찾는다", async (t) => {
    const { getLeadFollowup } = await load(t);
    const { conn } = fakeConn(baseResponder(alertRow({}), { followupByRecord: false }));
    const detail = await getLeadFollowup(conn, ORG, 42, NOW, ENV);
    assert.equal(detail.excludedReason, "판정한 방문 기록을 지금 다시 확인할 수 없습니다.");
    assert.equal(detail.archivedFollowup?.revision, 3);
    assert.equal(detail.history.length, 2);
});

test("UX-278 판정도 후속 대응도 없던 고객은 빈 이력과 '판정 기록 없음'", async (t) => {
    const { getLeadFollowup } = await load(t);
    const { conn } = fakeConn((text) => {
        if (text.startsWith("SELECT id FROM records")) return [{ id: 42 }];
        return [];
    });
    const detail = await getLeadFollowup(conn, ORG, 42, NOW, ENV);
    assert.deepEqual(detail, { lead: null, history: [], archivedFollowup: null, excludedReason: "이 고객의 메일 유입 여정 판정 기록이 없습니다." });
});

test("UX-278 유효 판정이 없으면 저장은 기존처럼 404로 막는다 (재알림 대상 판정 불변)", async (t) => {
    const { saveLeadFollowup, LeadFollowupError } = await load(t);
    const { conn } = fakeConn(baseResponder(alertRow({ created_at: new Date("2026-09-01T00:00:00Z") })));
    await assert.rejects(
        saveLeadFollowup(conn, { orgId: ORG, userId: "u1", name: "김담당" }, 42, { status: "consulting", dueAt: null, note: "", revision: 3 }, NOW, ENV),
        (e: unknown) => e instanceof LeadFollowupError && e.status === 404,
    );
});

test("UX-278 다른 조직 레코드는 404", async (t) => {
    const { getLeadFollowup, LeadFollowupError } = await load(t);
    const { conn } = fakeConn(() => []);
    await assert.rejects(getLeadFollowup(conn, ORG, 42, NOW, ENV), (e: unknown) => e instanceof LeadFollowupError && e.status === 404);
});
