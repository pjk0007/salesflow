import { test } from "node:test";
import assert from "node:assert";
import {
    emailKeysOf,
    emailPairsByKey,
    eventLabelsOf,
    funnelFieldStagesOf,
    groupByOrg,
    needsPostDetectionDelivery,
    resolveFieldDefs,
    siteVisitorKey,
    splitCandidateRows,
    toCandidateRow,
    type CandidateJson,
    type CandidateRow,
    type FieldDefJson,
    type FieldDefRow,
    type SiteAlias,
    type SiteFunnel,
} from "./deep-visitor-alert-batch";
import { buildTrackerLabelMaps } from "./journey/tracker-label-maps";
import type { SessionInput } from "./deep-visitor-alert-rules";

const ORG = "org-a";
const OTHER = "org-b";

function funnel(over: Partial<SiteFunnel>): SiteFunnel {
    return {
        id: 1,
        orgId: ORG,
        kind: "marketing",
        isDefault: 1,
        createdAt: "2026-09-01T00:00:00+00:00",
        stages: [],
        ...over,
    };
}

const fieldStage = (field: string, value: string) => ({
    key: `${field}-${value}`,
    label: value,
    match: { type: "record_field" as const, field, value },
});
const eventStage = (eventName: string, label: string) => ({
    key: eventName,
    label,
    match: { type: "custom_event" as const, eventName },
});

// ── funnelFieldStagesOf — 예전 loadFunnelFieldStages (기본 marketing 퍼널 중 가장 늦게 만든 것) ──

test("funnelFieldStagesOf: 이 조직의 기본 marketing 퍼널 중 가장 늦게 만든 것의 record_field 단계만", () => {
    const stages = funnelFieldStagesOf(
        [
            funnel({ id: 1, createdAt: "2026-09-01T00:00:00+00:00", stages: [fieldStage("stage", "옛날")] }),
            funnel({
                id: 2,
                createdAt: "2026-09-10T00:00:00+00:00",
                stages: [fieldStage("match_stage", "신청완료"), eventStage("signup", "가입"), { key: "p", label: "p", match: { type: "page_url", pathPrefix: "/x" } }],
            }),
            // 다른 조직·다른 종류·기본 아님은 고르지 않는다 (더 늦게 만들었어도)
            funnel({ id: 3, orgId: OTHER, createdAt: "2026-09-20T00:00:00+00:00", stages: [fieldStage("x", "다른조직")] }),
            funnel({ id: 4, kind: "event", createdAt: "2026-09-20T00:00:00+00:00", stages: [fieldStage("x", "이벤트")] }),
            funnel({ id: 5, isDefault: 0, createdAt: "2026-09-20T00:00:00+00:00", stages: [fieldStage("x", "기본아님")] }),
        ],
        ORG
    );
    assert.deepEqual(stages, [{ field: "match_stage", value: "신청완료" }]);
});

test("funnelFieldStagesOf: 만든 시각이 같으면 id가 큰 쪽, 퍼널이 없으면 빈 목록", () => {
    const at = "2026-09-10T00:00:00+00:00";
    assert.deepEqual(
        funnelFieldStagesOf(
            [funnel({ id: 7, createdAt: at, stages: [fieldStage("a", "7")] }), funnel({ id: 9, createdAt: at, stages: [fieldStage("a", "9")] })],
            ORG
        ),
        [{ field: "a", value: "9" }]
    );
    assert.deepEqual(funnelFieldStagesOf([], ORG), []);
    assert.deepEqual(funnelFieldStagesOf([funnel({ stages: null })], ORG), []);
});

test("funnelFieldStagesOf: 칸이나 값이 빈 record_field 단계는 뺀다", () => {
    assert.deepEqual(
        funnelFieldStagesOf([funnel({ stages: [fieldStage("", "값"), fieldStage("칸", ""), fieldStage("칸", "값")] })], ORG),
        [{ field: "칸", value: "값" }]
    );
});

// ── eventLabelsOf — 예전 loadEventLabels (별칭 + 여정 화면 CUSTOM 라벨) ──

function alias(over: Partial<SiteAlias>): SiteAlias {
    return { orgId: ORG, eventType: "CLICK", eventName: "btn", label: "버튼", ...over };
}

test("eventLabelsOf: SECTION_VIEW·CLICK 별칭은 이 조직 것만, 앞뒤 공백을 지운다", () => {
    const labels = eventLabelsOf(
        [
            alias({ eventType: "SECTION_VIEW", eventName: "trust-cases", label: " 고객 사례 " }),
            alias({ eventType: "CLICK", eventName: "consult-cta", label: "상담 신청" }),
            alias({ eventType: "CLICK", eventName: "other", label: "다른 조직", orgId: OTHER }),
            alias({ eventType: "CLICK", eventName: "blank", label: "   " }),
        ],
        [],
        ORG
    );
    assert.deepEqual(labels, { "SECTION_VIEW:trust-cases": "고객 사례", "CLICK:consult-cta": "상담 신청" });
});

test("eventLabelsOf: CUSTOM은 별칭 뒤에 퍼널 단계 라벨이 덮어쓴다 (여정 화면 규칙, 조직을 거르지 않는다)", () => {
    const labels = eventLabelsOf(
        [
            alias({ eventType: "CUSTOM", eventName: "subscribe_step_1", label: "별칭 라벨" }),
            alias({ eventType: "CUSTOM", eventName: "ai_entry_click", label: "AI 입력", orgId: OTHER }),
        ],
        [funnel({ kind: "event", isDefault: 0, stages: [eventStage("subscribe_step_1", " 구독 1단계 ")] })],
        ORG
    );
    assert.deepEqual(labels, { "CUSTOM:subscribe_step_1": "구독 1단계", "CUSTOM:ai_entry_click": "AI 입력" });
});

test("buildTrackerLabelMaps: 퍼널 단계 이름을 모으고 빈 라벨은 넣지 않는다", () => {
    const maps = buildTrackerLabelMaps(
        [{ stages: [eventStage("a", "에이"), eventStage("b", " ")] }, { stages: null }],
        [{ eventName: "c", label: "씨" }, { eventName: "b", label: "비 별칭" }, { eventName: "d", label: null }]
    );
    assert.deepEqual([...maps.funnelStageEventNames], ["a", "b"]);
    assert.deepEqual(Object.fromEntries(maps.customEventLabels), { c: "씨", b: "비 별칭", a: "에이" });
});

// ── 작은 도우미 ──

test("emailKeysOf: 'email'을 맨 앞에 늘 넣고 중복·문자열 아닌 값을 뺀다", () => {
    assert.deepEqual(emailKeysOf(["work_email", "email", 3, "work_email"]), ["email", "work_email"]);
    assert.deepEqual(emailKeysOf(null), ["email"]);
});

test("groupByOrg: 조직끼리 묶고 처음 나온 순서를 지킨다", () => {
    const groups = groupByOrg([
        { id: 3, orgId: "b" },
        { id: 1, orgId: "a" },
        { id: 2, orgId: "b" },
    ]);
    assert.deepEqual(groups.map((g) => g.map((x) => x.id)), [[3, 2], [1]]);
});

test("siteVisitorKey: 사이트와 방문자로 가른다", () => {
    assert.notEqual(siteVisitorKey(1, 23), siteVisitorKey(12, 3));
});

test("needsPostDetectionDelivery: 탐지 앞에서 집은 줄이 없고 지금 보낼 새 줄도 없으면 집지 않는다", () => {
    assert.equal(needsPostDetectionDelivery({ preDeliveryClaimedAny: false, createdDueNow: 0 }), false);
    assert.equal(needsPostDetectionDelivery({ preDeliveryClaimedAny: true, createdDueNow: 0 }), true);
    assert.equal(needsPostDetectionDelivery({ preDeliveryClaimedAny: false, createdDueNow: 2 }), true);
});

// ── splitCandidateRows — 후보 한 문장을 워크스페이스별 재료로 ──

const T = (m: number) => new Date(Date.UTC(2026, 9, 2, 0, m));
function session(id: number, over: Partial<SessionInput> = {}): SessionInput {
    return { id, siteId: 11, visitorId: 100 + id, startedAt: T(id), endedAt: null, duration: 10, pageCount: 1, clickId: "c1", ...over };
}
function row(over: Partial<CandidateRow>): CandidateRow {
    return {
        workspaceId: 1,
        recordId: 5,
        sendLogId: 50,
        sentAt: T(0),
        recipientEmail: "kim@example.test",
        hasDeep: false,
        hasIntent: false,
        clickLogId: 500,
        clickId: "c1",
        clickedAt: T(3),
        session: session(1),
        ...over,
    };
}

test("splitCandidateRows: 워크스페이스마다 레코드·발송·클릭·찾은 세션을 나누고 중복을 뺀다", () => {
    const rows: CandidateRow[] = [
        // 같은 (발송, 클릭, 세션)이 최근 세션 여러 개 때문에 두 번 온다
        row({}),
        row({}),
        // 같은 클릭으로 찾은 다른 세션 (다른 사이트 — 자매 사이트·검사기)
        row({ session: session(2, { siteId: 99 }) }),
        // 같은 발송의 두 번째 클릭 (세션 없음)
        row({ clickLogId: 501, clickId: "c2", clickedAt: T(9), session: null }),
        // 다른 워크스페이스
        row({ workspaceId: 2, recordId: 7, sendLogId: 70, clickLogId: 700, clickId: "c7", session: session(7, { siteId: 12, clickId: "c7" }) }),
        // 목록에 없는 워크스페이스 줄은 버린다
        row({ workspaceId: 3, recordId: 9, sendLogId: 90 }),
    ];
    const split = splitCandidateRows(rows, [1, 2]);
    assert.deepEqual([...split.keys()], [1, 2]);

    const ws1 = split.get(1)!;
    assert.deepEqual([...ws1.sendIdsByRecord], [[5, [50]]]);
    assert.deepEqual(ws1.existingLevels.get(5), []);
    assert.deepEqual(ws1.sendById.get(50), { id: 50, recordId: 5, sentAt: T(0), recipientEmail: "kim@example.test" });
    assert.deepEqual(ws1.clicksBySend.get(50), [
        { clickId: "c1", clickedAt: T(3) },
        { clickId: "c2", clickedAt: T(9) },
    ]);
    assert.deepEqual(ws1.sessionsByClick.get("c1")?.map((s) => s.id), [1, 2]);
    assert.equal(ws1.sessionsByClick.has("c2"), false);

    const ws2 = split.get(2)!;
    assert.deepEqual([...ws2.sendIdsByRecord.keys()], [7]);
    assert.deepEqual(ws2.sessionsByClick.get("c7")?.map((s) => s.id), [7]);
});

test("splitCandidateRows: 줄 순서와 상관없이 같은 결과 (레코드는 가장 작은 발송 id 순, 발송·세션은 id 순)", () => {
    const rows: CandidateRow[] = [
        row({ recordId: 8, sendLogId: 80, clickLogId: 800, clickId: "c8", session: session(9, { clickId: "c8" }) }),
        row({ recordId: 5, sendLogId: 60, clickLogId: 600, clickId: "c6", session: null }),
        row({ recordId: 5, sendLogId: 50, clickLogId: 500, clickId: "c1", session: session(4) }),
        row({ recordId: 5, sendLogId: 50, clickLogId: 500, clickId: "c1", session: session(3) }),
    ];
    const a = splitCandidateRows(rows, [1]).get(1)!;
    const b = splitCandidateRows([...rows].reverse(), [1]).get(1)!;
    for (const ws of [a, b]) {
        assert.deepEqual([...ws.sendIdsByRecord], [[5, [50, 60]], [8, [80]]]);
        assert.deepEqual(ws.sessionsByClick.get("c1")?.map((s) => s.id), [3, 4]);
    }
});

test("splitCandidateRows: 알림 수준 — intent가 있으면 클릭이 오지 않아도 후보로 세고 수준을 남긴다", () => {
    const split = splitCandidateRows(
        [
            row({ recordId: 5, hasDeep: true, hasIntent: true, clickLogId: null, clickId: null, clickedAt: null, session: null }),
            row({ recordId: 6, sendLogId: 51, hasDeep: true, clickLogId: 510 }),
        ],
        [1]
    ).get(1)!;
    assert.deepEqual(split.existingLevels.get(5), ["deep", "intent"]);
    assert.deepEqual(split.existingLevels.get(6), ["deep"]);
    assert.equal(split.clicksBySend.has(50), false);
    assert.equal(split.sendIdsByRecord.size, 2);
});

// ============================================
// JSON 후보 줄 → CandidateRow
// ============================================

function candJson(over: Partial<CandidateJson> = {}): CandidateJson {
    return {
        workspace_id: 1,
        record_id: 5,
        send_log_id: 50,
        sent_at: "2026-10-02T09:00:00+09:00",
        recipient_email: "a@x.test",
        has_deep: false,
        has_intent: false,
        click_log_id: 500,
        click_id: "c1",
        clicked_at: "2026-10-02T10:00:00.5+09:00",
        s_id: 3,
        s_site_id: 7,
        s_visitor_id: 9,
        s_started_at: "2026-10-02T10:00:01+09:00",
        s_ended_at: null,
        s_duration: 120,
        s_page_count: 4,
        s_click_id: "c1",
        ...over,
    };
}

test("toCandidateRow: 칸 이름·시각을 예전 조회 모양으로 바꾼다", () => {
    const r = toCandidateRow(candJson());
    assert.equal(r.workspaceId, 1);
    assert.equal(r.recordId, 5);
    assert.equal(r.sendLogId, 50);
    assert.equal(r.sentAt.toISOString(), "2026-10-02T00:00:00.000Z");
    assert.equal(r.recipientEmail, "a@x.test");
    assert.equal(r.clickedAt?.toISOString(), "2026-10-02T01:00:00.500Z");
    assert.deepEqual(r.session, {
        id: 3,
        siteId: 7,
        visitorId: 9,
        startedAt: new Date("2026-10-02T01:00:01.000Z"),
        endedAt: null,
        duration: 120,
        pageCount: 4,
        clickId: "c1",
    });
});

test("toCandidateRow: 찾은 세션은 id·사이트·방문자·시작 시각이 다 있을 때만", () => {
    for (const key of ["s_id", "s_site_id", "s_visitor_id", "s_started_at"] as const) {
        assert.equal(toCandidateRow(candJson({ [key]: null })).session, null, key);
    }
    const noClick = toCandidateRow(candJson({ click_log_id: null, click_id: null, clicked_at: null, s_id: null }));
    assert.equal(noClick.clickLogId, null);
    assert.equal(noClick.clickedAt, null);
    assert.equal(noClick.session, null);
});

test("toCandidateRow: 알림 수준은 true일 때만 참 (null·false는 없음)", () => {
    assert.deepEqual(
        [true, false, null].map((v) => toCandidateRow(candJson({ has_deep: v, has_intent: v }))).map((r) => [r.hasDeep, r.hasIntent]),
        [[true, true], [false, false], [false, false]]
    );
});

test("toCandidateRow → splitCandidateRows: JSON으로 받아도 예전 줄과 같은 재료가 된다", () => {
    const fromJson = splitCandidateRows([toCandidateRow(candJson())], [1]).get(1)!;
    assert.deepEqual([...fromJson.sendIdsByRecord], [[5, [50]]]);
    assert.deepEqual(fromJson.clicksBySend.get(50), [{ clickId: "c1", clickedAt: new Date("2026-10-02T01:00:00.500Z") }]);
    assert.deepEqual(fromJson.sessionsByClick.get("c1")?.map((s) => [s.id, s.visitorId]), [[3, 9]]);
});

// ============================================
// 같은 메일 레코드 조회의 짝
// ============================================

test("emailPairsByKey: 칸 키마다 (워크스페이스, 주소) 짝 — 그 키를 쓰는 워크스페이스의 주소만", () => {
    const pairs = emailPairsByKey([
        { workspaceId: 1, keys: ["email", "contactEmail"], emails: ["a@x.test", "b@x.test"] },
        { workspaceId: 2, keys: ["email"], emails: ["c@y.test"] },
    ]);
    assert.deepEqual([...pairs.keys()], ["email", "contactEmail"]);
    assert.deepEqual(pairs.get("email"), { ws: [1, 1, 2], emails: ["a@x.test", "b@x.test", "c@y.test"] });
    assert.deepEqual(pairs.get("contactEmail"), { ws: [1, 1], emails: ["a@x.test", "b@x.test"] });
});

test("emailPairsByKey: 주소가 없는 워크스페이스는 빠지고, 같은 키가 두 번 와도 짝은 한 번", () => {
    const pairs = emailPairsByKey([
        { workspaceId: 1, keys: ["email", "email"], emails: ["a@x.test"] },
        { workspaceId: 2, keys: ["email", "mail2"], emails: [] },
    ]);
    assert.deepEqual([...pairs], [["email", { ws: [1], emails: ["a@x.test"] }]]);
    assert.equal(emailPairsByKey([]).size, 0);
});

// ============================================
// 카드 칸 정의 고르기
// ============================================

const fd = (key: string, fieldTypeId: number | null, workspaceId: number | null): FieldDefJson => ({
    key,
    label: key.toUpperCase(),
    field_type: "text",
    field_type_id: fieldTypeId,
    workspace_id: workspaceId,
});
// sort_order, id 순으로 함께 읽은 줄 (타입 10·20의 칸, 워크스페이스 1·2 직속 칸)
const FIELD_ROWS = [fd("name", 10, null), fd("ws1Direct", null, 1), fd("phone", 20, null), fd("email", 10, null), fd("ws2Direct", null, 2)];

test("resolveFieldDefs: 파티션 타입 → 워크스페이스 기본 타입 → 워크스페이스 직속 칸 (순서 그대로)", () => {
    const keys = (rows: FieldDefRow[]) => rows.map((r) => r.key);
    assert.deepEqual(keys(resolveFieldDefs({ id: 1, defaultFieldTypeId: 20 }, { fieldTypeId: 10 }, FIELD_ROWS, new Map())), ["name", "email"]);
    assert.deepEqual(keys(resolveFieldDefs({ id: 1, defaultFieldTypeId: 20 }, { fieldTypeId: null }, FIELD_ROWS, new Map())), ["phone"]);
    assert.deepEqual(keys(resolveFieldDefs({ id: 1, defaultFieldTypeId: 20 }, null, FIELD_ROWS, new Map())), ["phone"]);
    assert.deepEqual(keys(resolveFieldDefs({ id: 1, defaultFieldTypeId: null }, null, FIELD_ROWS, new Map())), ["ws1Direct"]);
    assert.deepEqual(keys(resolveFieldDefs({ id: 2, defaultFieldTypeId: null }, { fieldTypeId: null }, FIELD_ROWS, new Map())), ["ws2Direct"]);
    assert.deepEqual(resolveFieldDefs({ id: 1, defaultFieldTypeId: 10 }, null, FIELD_ROWS, new Map())[0], {
        key: "name",
        label: "NAME",
        fieldType: "text",
    });
});

test("resolveFieldDefs: 같은 해석은 캐시에서 같은 목록을 꺼낸다 (워크스페이스가 달라도 타입이 같으면 같다)", () => {
    const cache = new Map<string, FieldDefRow[]>();
    const a = resolveFieldDefs({ id: 1, defaultFieldTypeId: null }, { fieldTypeId: 10 }, FIELD_ROWS, cache);
    const b = resolveFieldDefs({ id: 2, defaultFieldTypeId: 20 }, { fieldTypeId: 10 }, FIELD_ROWS, cache);
    assert.equal(a, b);
    assert.deepEqual([...cache.keys()], ["type:10"]);
    const direct = resolveFieldDefs({ id: 1, defaultFieldTypeId: null }, null, [], cache);
    assert.deepEqual(direct, []);
    assert.deepEqual([...cache.keys()], ["type:10", "ws:1"]);
});
