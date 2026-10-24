import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";

// 실제 DB에 접속하지 않는다 — 메모리 PGlite에 스키마의 표 모양만 만들고(마이그레이션 미적용) 생성 경로를 검증한다.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";

const ORG = "00000000-0000-4000-8000-0000000000f4";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000f5";

async function setup() {
    const schema = await import("./db/schema");
    const { openPglite, insertRow } = await import("./db/pglite-harness.test-helper");
    const { drizzle } = await import("drizzle-orm/pglite");
    const pg = await openPglite([schema.organizations, schema.workspaces, schema.partitions, schema.records, schema.fieldDefinitions]);
    await insertRow(pg, "organizations", { id: ORG, name: "가상 조직", slug: "f4-org", integrated_code_prefix: "SALES", integrated_code_seq: 11 });
    await insertRow(pg, "organizations", { id: OTHER_ORG, name: "다른 조직", slug: "f4-other", integrated_code_prefix: "OTHER", integrated_code_seq: 0 });
    await insertRow(pg, "workspaces", { id: 1, org_id: ORG, name: "가상 워크스페이스", default_field_type_id: 7 });
    await insertRow(pg, "partitions", {
        id: 10, workspace_id: 1, name: "분배 파티션", use_distribution_order: 1, max_distribution_order: 3, last_assigned_order: 0,
        distribution_defaults: JSON.stringify({ 1: [{ field: "owner", value: "담당A" }], 2: [{ field: "owner", value: "담당B" }, { field: "status", value: "배정됨" }], 3: [{ field: "owner", value: "담당C" }] }),
    });
    await insertRow(pg, "partitions", { id: 20, workspace_id: 1, name: "분배 끈 파티션", use_distribution_order: 0 });
    await insertRow(pg, "field_definitions", { field_type_id: 7, key: "status", label: "상태", field_type: "select", default_value: "신규" });
    await insertRow(pg, "field_definitions", { field_type_id: 7, key: "phone", label: "전화번호", field_type: "phone" });
    const db = drizzle(pg, { schema });
    return { pg, db, schema };
}

function spyEffects() {
    const calls: Array<{ effect: string; recordId: number; detail?: string }> = [];
    return {
        calls,
        effects: {
            dispatchAutoTriggers: (p: { record: { id: number } }) => { calls.push({ effect: "automation", recordId: p.record.id }); },
            processAutoEnrich: async (p: { record: { id: number } }) => { calls.push({ effect: "enrich", recordId: p.record.id }); },
            notifyRecordChatAlert: async (p: { recordId: number; source: string; kind?: string }) => {
                calls.push({ effect: "chat", recordId: p.recordId, detail: `${p.source}:${p.kind}` });
            },
            broadcastToPartition: (_partitionId: number, event: string, data: { recordId?: number }) => {
                calls.push({ effect: "sse", recordId: data.recordId ?? 0, detail: event });
            },
        },
    };
}

function partitionInfo(id: number, duplicateConfig: { field: string; action: string } | null = null) {
    return { id, workspaceId: 1, duplicateConfig, duplicateCheckField: null };
}

async function rows(pg: PGlite, partitionId: number) {
    const { rows } = await pg.query<{ id: number; integrated_code: string; distribution_order: number | null; data: Record<string, unknown> }>(
        "SELECT id, integrated_code, distribution_order, data FROM records WHERE partition_id = $1 ORDER BY id", [partitionId]);
    return rows;
}

test("T10 경로별(화면·웹 폼·v1·Meta·MCP·가져오기) 생성이 통합코드를 이어 받고 분배 번호가 순환하며 기본값 우선순위를 지킨다", async () => {
    const { pg, db } = await setup();
    try {
        const { createRecord } = await import("./record-create");
        const { insertImportedRecords } = await import("./record-import");
        const spy = spyEffects();
        const deps = { db: db as never, effects: spy.effects as never, planLimit: async () => ({ allowed: true, limit: 100 }) };

        const screen = await createRecord({ orgId: ORG, partition: partitionInfo(10), data: { name: "화면", status: "" }, source: "screen", enforcePlanLimit: true, sessionId: "s1" }, deps);
        const webForm = await createRecord({ orgId: ORG, partition: partitionInfo(10), data: { name: "웹폼", campaignName: "실제 캠페인" }, sourceDefaults: { campaignName: "폼 기본", owner: "폼 담당" }, source: "web_form" }, deps);
        const api = await createRecord({ orgId: ORG, partition: partitionInfo(10), data: { name: "API", status: "상담중" }, source: "api" }, deps);
        const meta = await createRecord({ orgId: ORG, partition: partitionInfo(10), data: { name: "Meta" }, sourceDefaults: { source: "meta" }, source: "meta_ad" }, deps);
        const mcp = await createRecord({ orgId: ORG, partition: partitionInfo(10), data: { name: "MCP" }, source: "mcp" }, deps);
        const imported = await insertImportedRecords(db as never, {
            orgId: ORG, partition: partitionInfo(10), dataRows: [{ name: "가져오기1" }, { name: "가져오기2" }], codeExecutor: db as never,
        });

        for (const r of [screen, webForm, api, meta, mcp]) assert.equal(r.status, "created");
        assert.equal(imported.insertedCount, 2);

        const saved = await rows(pg, 10);
        // 통합코드: 조직 순번 11 다음부터 경로와 무관하게 0 채움 4자리로 끊김 없이 이어진다 (Meta도 'SALES-12'가 아니다)
        assert.deepEqual(saved.map((r) => r.integrated_code), ["SALES-0012", "SALES-0013", "SALES-0014", "SALES-0015", "SALES-0016", "SALES-0017", "SALES-0018"]);
        const { rows: [org] } = await pg.query<{ integrated_code_seq: number }>("SELECT integrated_code_seq FROM organizations WHERE id = $1", [ORG]);
        assert.equal(org.integrated_code_seq, 18);

        // 분배: 단건 경로는 1→2→3→1→2 순환, 가져오기는 기존처럼 분배하지 않는다
        assert.deepEqual(saved.map((r) => r.distribution_order), [1, 2, 3, 1, 2, null, null]);
        const byName = new Map(saved.map((r) => [r.data.name, r.data]));
        // 화면: 빈 상태는 필드 기본값, 담당은 분배 1번
        assert.deepEqual(byName.get("화면"), { name: "화면", status: "신규", owner: "담당A" });
        // 웹 폼: 입력(실제 캠페인) > 폼 기본값(담당) > 분배 2번(상태 '배정됨') > 필드 기본값
        assert.deepEqual(byName.get("웹폼"), { name: "웹폼", campaignName: "실제 캠페인", owner: "폼 담당", status: "배정됨" });
        // v1: 입력 상태가 분배·필드 기본값보다 우선
        assert.deepEqual(byName.get("API"), { name: "API", status: "상담중", owner: "담당C" });
        // Meta: 연동 기본값은 빈 칸만, 분배 1번·필드 기본값 적용
        assert.deepEqual(byName.get("Meta"), { name: "Meta", source: "meta", owner: "담당A", status: "신규" });
        // MCP: 분배 2번 기본값이 필드 기본값보다 우선
        assert.deepEqual(byName.get("MCP"), { name: "MCP", owner: "담당B", status: "배정됨" });
        assert.deepEqual(byName.get("가져오기1"), { name: "가져오기1" });

        // 후처리: 생성 한 건당 자동화·보강·SSE 정확히 1회, 구글챗은 고객 유입 경로(web_form·api·meta_ad)만
        const created = [screen, webForm, api, meta, mcp].map((r) => (r.status === "created" ? r.record.id : 0));
        for (const id of created) {
            assert.equal(spy.calls.filter((c) => c.recordId === id && c.effect === "automation").length, 1);
            assert.equal(spy.calls.filter((c) => c.recordId === id && c.effect === "enrich").length, 1);
            assert.equal(spy.calls.filter((c) => c.recordId === id && c.effect === "sse" && c.detail === "record:created").length, 1);
        }
        assert.deepEqual(spy.calls.filter((c) => c.effect === "chat").map((c) => c.detail), ["web_form:created", "api:created", "meta_ad:created"]);
    } finally {
        await pg.close();
    }
});

test("T10 분배를 끈 파티션은 분배 번호 없이 필드 기본값만 적용한다", async () => {
    const { pg, db } = await setup();
    try {
        const { createRecord } = await import("./record-create");
        const spy = spyEffects();
        const result = await createRecord({ orgId: ORG, partition: partitionInfo(20), data: { name: "끔" }, source: "web_form" }, { db: db as never, effects: spy.effects as never });
        assert.equal(result.status, "created");
        const [saved] = await rows(pg, 20);
        assert.equal(saved.distribution_order, null);
        assert.deepEqual(saved.data, { name: "끔", status: "신규" });
        const { rows: [p] } = await pg.query<{ last_assigned_order: number }>("SELECT last_assigned_order FROM partitions WHERE id = 20");
        assert.equal(p.last_assigned_order, 0);
    } finally {
        await pg.close();
    }
});

test("T10 동시 생성은 통합코드·분배 번호가 겹치지 않는다", async () => {
    const { pg, db } = await setup();
    try {
        const { createRecord } = await import("./record-create");
        const spy = spyEffects();
        await Promise.all(Array.from({ length: 6 }, (_, i) =>
            createRecord({ orgId: ORG, partition: partitionInfo(10), data: { name: `동시${i}` }, source: "api" }, { db: db as never, effects: spy.effects as never })));
        const saved = await rows(pg, 10);
        assert.equal(new Set(saved.map((r) => r.integrated_code)).size, 6);
        assert.deepEqual(saved.map((r) => r.distribution_order).sort(), [1, 1, 2, 2, 3, 3]);
    } finally {
        await pg.close();
    }
});

test("UX-071 가져오기가 범위를 예약하는 사이 들어온 단건 리드와 통합코드가 겹치지 않고, 건너뜀·병합 행은 번호를 쓰지 않는다", async () => {
    const { pg, db } = await setup();
    try {
        const { createRecord, reserveIntegratedCodes } = await import("./record-create");
        const { insertImportedRecords } = await import("./record-import");
        const spy = spyEffects();
        const dupPartition = partitionInfo(20, { field: "phone", action: "merge" });
        await createRecord({ orgId: ORG, partition: dupPartition, data: { phone: "010-1111-1111", name: "기존" }, source: "screen" }, { db: db as never, effects: spy.effects as never });

        // 가져오기 예약 직후 웹 폼 리드가 끼어드는 상황을 실행기로 재현한다
        let interleaved = "";
        const codeExecutor = {
            update: (table: Parameters<typeof db.update>[0]) => {
                const builder = db.update(table);
                return {
                    set: (v: never) => ({
                        where: (w: never) => ({
                            returning: async (r: never) => {
                                const result = await builder.set(v).where(w).returning(r);
                                const single = await createRecord({ orgId: ORG, partition: partitionInfo(20), data: { name: "끼어든 웹폼" }, source: "web_form" }, { db: db as never, effects: spy.effects as never });
                                if (single.status === "created") interleaved = single.record.integratedCode ?? "";
                                return result;
                            },
                        }),
                    }),
                };
            },
        };
        const result = await insertImportedRecords(db as never, {
            orgId: ORG,
            partition: dupPartition,
            dataRows: [{ phone: "010-1111-1111", name: "병합" }, { phone: "010-2222-2222", name: "새1" }, { phone: "010-2222-2222", name: "배치 중복" }, { phone: "010-3333-3333", name: "새2" }],
            codeExecutor: codeExecutor as never,
        });
        assert.deepEqual([result.insertedCount, result.mergedCount, result.skippedCount], [2, 1, 1]);
        const codes = (await rows(pg, 20)).map((r) => r.integrated_code);
        // 기존 0012, 가져오기 예약 0013·0014(생성 2건만), 끼어든 리드 0015
        assert.deepEqual(codes.sort(), ["SALES-0012", "SALES-0013", "SALES-0014", "SALES-0015"]);
        assert.equal(interleaved, "SALES-0015");
        assert.deepEqual(await reserveIntegratedCodes(db as never, ORG, 2), ["SALES-0016", "SALES-0017"]);
    } finally {
        await pg.close();
    }
});

test("UX-043·066 중복 정책: 거부는 필드 이름으로 알리고, 병합은 on_create 자동화 없이 갱신 알림, 교체는 생성 실패 시 기존 레코드를 보존한다", async () => {
    const { pg, db } = await setup();
    try {
        const { createRecord } = await import("./record-create");
        const spy = spyEffects();
        const deps = { db: db as never, effects: spy.effects as never };
        const seed = await createRecord({ orgId: ORG, partition: partitionInfo(20), data: { phone: "010-1234-5678", name: "원본", memo: "남김" }, source: "screen" }, deps);
        assert.equal(seed.status, "created");
        const seedId = seed.status === "created" ? seed.record.id : 0;

        const reject = await createRecord({ orgId: ORG, partition: partitionInfo(20, { field: "phone", action: "reject" }), data: { phone: "010-1234-5678" }, source: "web_form" }, deps);
        assert.deepEqual(reject, { status: "duplicate", field: "phone", fieldLabel: "전화번호", value: "010-1234-5678", existingRecordId: seedId });

        spy.calls.length = 0;
        const merged = await createRecord({ orgId: ORG, partition: partitionInfo(20, { field: "phone", action: "merge" }), data: { phone: "010-1234-5678", name: "재접수" }, sourceDefaults: { status: "폼 기본" }, source: "web_form" }, deps);
        assert.equal(merged.status, "merged");
        assert.equal(merged.status === "merged" && merged.record.id, seedId);
        assert.deepEqual(merged.status === "merged" && merged.record.data, { phone: "010-1234-5678", name: "재접수", memo: "남김", status: "신규" });
        assert.deepEqual(spy.calls.map((c) => `${c.effect}:${c.detail ?? ""}`), ["chat:web_form:merged", "sse:record:updated"]);
        assert.equal((await rows(pg, 20)).length, 1);

        // 교체: 같은 트랜잭션 안에서 생성이 실패하면 기존 레코드가 그대로 남는다
        await assert.rejects(createRecord({
            orgId: ORG, partition: partitionInfo(20, { field: "phone", action: "delete_old" }), data: { phone: "010-1234-5678", name: "교체" }, source: "screen",
            inTransaction: async () => { throw new Error("가상 생성 실패"); },
        }, deps), /가상 생성 실패/);
        assert.deepEqual((await rows(pg, 20)).map((r) => r.id), [seedId]);

        const replaced = await createRecord({ orgId: ORG, partition: partitionInfo(20, { field: "phone", action: "delete_old" }), data: { phone: "010-1234-5678", name: "교체" }, source: "screen" }, deps);
        assert.equal(replaced.status, "created");
        assert.deepEqual((await rows(pg, 20)).map((r) => r.data.name), ["교체"]);

        const allowed = await createRecord({ orgId: ORG, partition: partitionInfo(20, { field: "phone", action: "allow" }), data: { phone: "010-1234-5678", name: "허용" }, source: "screen" }, deps);
        assert.equal(allowed.status, "created");
        assert.equal((await rows(pg, 20)).length, 2);
    } finally {
        await pg.close();
    }
});

test("T10 중복 검사는 다른 조직이 같은 파티션에 넣은 레코드를 기준으로 삼지 않는다", async () => {
    const { pg, db } = await setup();
    try {
        const { insertRow } = await import("./db/pglite-harness.test-helper");
        const { createRecord } = await import("./record-create");
        await insertRow(pg, "records", { org_id: OTHER_ORG, workspace_id: 1, partition_id: 20, data: JSON.stringify({ phone: "010-9999-0000" }) });
        const spy = spyEffects();
        const result = await createRecord({ orgId: ORG, partition: partitionInfo(20, { field: "phone", action: "merge" }), data: { phone: "010-9999-0000", name: "정상" }, source: "api" }, { db: db as never, effects: spy.effects as never });
        assert.equal(result.status, "created");
    } finally {
        await pg.close();
    }
});

test("T10 요금제 한도·트랜잭션 내 작업·후처리 실패 기록", async () => {
    const { pg, db } = await setup();
    try {
        const { createRecord } = await import("./record-create");
        const spy = spyEffects();
        const blocked = await createRecord({ orgId: ORG, partition: partitionInfo(20), data: { name: "한도" }, source: "mcp", enforcePlanLimit: true },
            { db: db as never, effects: spy.effects as never, planLimit: async () => ({ allowed: false, limit: 50 }) });
        assert.deepEqual(blocked, { status: "plan_limit", limit: 50 });
        assert.equal((await rows(pg, 20)).length, 0);

        // 웹 폼처럼 한도를 강제하지 않는 경로는 한도 함수를 부르지 않는다
        let limitCalls = 0;
        await createRecord({ orgId: ORG, partition: partitionInfo(20), data: { name: "웹폼" }, source: "web_form" },
            { db: db as never, effects: spy.effects as never, planLimit: async () => { limitCalls++; return { allowed: false, limit: 0 }; } });
        assert.equal(limitCalls, 0);

        const withEvent = await createRecord({
            orgId: ORG, partition: partitionInfo(20), data: { name: "이벤트" }, source: "api",
            inTransaction: async (_tx, record, kind) => `${kind}:${record.integratedCode}`,
        }, { db: db as never, effects: spy.effects as never });
        assert.equal(withEvent.status === "created" && withEvent.extra, "created:SALES-0013");

        // 후처리 하나가 실패해도 나머지는 돌고, 실패는 같은 형식으로 기록된다
        const logged: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { logged.push(String(args[0])); };
        let sse = 0;
        try {
            await createRecord({ orgId: ORG, partition: partitionInfo(20), data: { name: "실패" }, source: "web_form" }, {
                db: db as never,
                effects: {
                    ...spy.effects,
                    dispatchAutoTriggers: () => { throw new Error("자동화 실패"); },
                    notifyRecordChatAlert: async () => { throw new Error("알림 실패"); },
                    broadcastToPartition: () => { sse++; },
                } as never,
            });
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            console.error = original;
        }
        assert.equal(sse, 1);
        assert.ok(logged.some((l) => /^\[record-create\] 자동화 실패 \(record=\d+, partition=20, source=web_form\)/.test(l)), logged.join("\n"));
        assert.ok(logged.some((l) => /^\[record-create\] 구글챗 알림 실패/.test(l)), logged.join("\n"));
    } finally {
        await pg.close();
    }
});

test("UX-065 자동 보강 병합은 그사이 사람이 바꾼 값을 지키고 빈 칸만 채우며 규칙 결과가 누적된다", async () => {
    const { pg, db } = await setup();
    try {
        const { insertRow } = await import("./db/pglite-harness.test-helper");
        const { mergeEnrichedFields, loadRecordData } = await import("./auto-enrich");
        await insertRow(pg, "records", { id: 500, org_id: ORG, workspace_id: 1, partition_id: 20, data: JSON.stringify({ company: "가상회사", status: "신규", homepage: "" }) });
        // 보강이 생성 시점 사본을 들고 있는 사이 담당자가 상태를 바꿨다
        await pg.query(`UPDATE records SET data = data || '{"status":"상담중","owner":"담당A"}'::jsonb WHERE id = 500`);
        assert.equal(await mergeEnrichedFields(db as never, 500, { status: "보강값", homepage: "https://example.test", industry: "제조" }), true);
        // 두 번째 규칙은 최신 행에서 시작해 앞 규칙 값을 지우지 않는다
        assert.equal(await mergeEnrichedFields(db as never, 500, { industry: "다른값", employees: "50" }), true);
        assert.deepEqual(await loadRecordData(db as never, 500), {
            company: "가상회사", status: "상담중", owner: "담당A", homepage: "https://example.test", industry: "제조", employees: "50",
        });
        assert.equal(await mergeEnrichedFields(db as never, 999, { a: "b" }), false);
    } finally {
        await pg.close();
    }
});

test("UX-046 체크박스 값 해석은 true·1·'true'·'1'만 참이다", async () => {
    const { parseCheckboxValue } = await import("./checkbox-value");
    for (const v of [true, 1, "true", "TRUE", " 1 "]) assert.equal(parseCheckboxValue(v), true, String(v));
    for (const v of [false, 0, "false", "FALSE", "0", "", null, undefined, "no"]) assert.equal(parseCheckboxValue(v), false, String(v));
});

test("T10 기본값 병합 규칙: 입력 > 폼·연동 기본값 > 분배 기본값 > 필드 기본값, 빈 값은 채움 대상", async () => {
    const { buildCreateData } = await import("./record-create");
    assert.deepEqual(
        buildCreateData({ a: "입력", b: "", c: null }, { b: "폼", d: "폼" }, { b: "분배", c: "분배", d: "분배", e: "" }, { e: "필드", a: "필드" }),
        { a: "입력", b: "폼", c: "분배", d: "폼", e: "필드" }
    );
});
