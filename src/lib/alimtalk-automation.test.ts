import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { installFakeDb, isolateEnv, type FakeCall } from "./auth-fake-db.test-helper";

// 자동·반복·후속 알림톡 경로 — 가상 db와 가상 공급자(fetch)로만 확인한다. 실제 DB·NHN 호출 없음.
const header = { isSuccessful: true, resultCode: 0, resultMessage: "접수" };
const baseLink = { id: 7, partitionId: 3, name: "가상 연결", senderKey: "fake-sender", templateCode: "A", templateName: "가상 A",
    recipientField: "phone", variableMappings: null, triggerType: "on_create", triggerCondition: null, repeatConfig: null,
    followupConfig: null, preventDuplicate: 0, isActive: 1 };
const record = (data: Record<string, unknown>) => ({ id: 11, orgId: "fake-org", partitionId: 3, data });

interface Options {
    links?: Array<Record<string, unknown>>;
    queue?: Array<Record<string, unknown>>;
    records?: Array<Record<string, unknown>>;
    parentLog?: Array<Record<string, unknown>>;
    template?: (code: string) => Response | Promise<Response>;
}

async function fixture(t: TestContext, options: Options = {}) {
    isolateEnv(t);
    const { db } = await import("./db");
    const automation = await import("./alimtalk-automation");
    const posts: unknown[] = [];
    let linkSelects = 0;
    const { calls } = installFakeDb(t, db, (call: FakeCall) => {
        if (call.op === "select" && call.table === "alimtalk_configs") return [{ appKey: "fake", secretKey: "fake" }];
        if (call.op === "select" && call.table === "alimtalk_template_links") { linkSelects++; return options.links ?? [baseLink]; }
        if (call.op === "select" && call.table === "alimtalk_automation_queue") return options.queue ?? [];
        if (call.op === "select" && call.table === "records") return options.records ?? [];
        if (call.op === "select" && call.table === "alimtalk_send_logs") return call.sql.includes('"trigger_type"') || call.sql.includes('"status"') ? [] : options.parentLog ?? [];
        if (call.op === "insert" && call.table === "alimtalk_send_logs") return (Array.isArray(call.values) ? call.values : [call.values]).map((_, i) => ({ id: 100 + i }));
        return [];
    });
    t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
            posts.push(JSON.parse(String(init.body)));
            return Response.json({ header, message: { requestId: "fake-request", sendResults: [{ recipientNo: "01000000001", recipientSeq: 1, resultCode: 0, resultMessage: "접수" }] } });
        }
        const code = decodeURIComponent(String(url).split("/templates/")[1] ?? "");
        if (options.template) return options.template(code);
        return Response.json({ header, template: { templateContent: "가상 본문", templateName: "가상" } });
    });
    const failedLogs = () => calls.filter(c => c.op === "insert" && c.table === "alimtalk_send_logs")
        .flatMap(c => (Array.isArray(c.values) ? c.values : [c.values]) as Array<{ status: string; resultMessage: string; triggerType: string }>)
        .filter(v => v.status === "failed");
    return { automation, calls, posts, failedLogs, linkSelects: () => linkSelects };
}

test("UX-255: 수신번호 누락·형식 오류는 공급자 호출 없이 failed 이력과 한국어 사유를 남긴다", async t => {
    for (const [data, reason] of [[{}, /수신번호 없음/], [{ phone: "010-12" }, /수신번호 형식 오류/]] as const) await t.test(String(reason), async t => {
        const f = await fixture(t);
        await f.automation.processAutoTrigger({ record: record(data) as never, partitionId: 3, triggerType: "on_create", orgId: "fake-org" });
        assert.equal(f.posts.length, 0);
        const logs = f.failedLogs();
        assert.equal(logs.length, 1);
        assert.match(logs[0].resultMessage, reason);
        assert.match(logs[0].resultMessage, /수신번호 필드: phone/);
        assert.equal(logs[0].triggerType, "auto");
    });
});

test("UX-255: 한 연결의 템플릿 조회 예외는 사유를 남기고 다음 연결은 그대로 발송한다", async t => {
    const f = await fixture(t, {
        links: [baseLink, { ...baseLink, id: 8, templateCode: "B" }],
        template: code => { if (code === "A") throw new Error("fake template timeout"); return Response.json({ header, template: { templateContent: "가상 본문" } }); },
    });
    await f.automation.processAutoTrigger({ record: record({ phone: "010-0000-0001" }) as never, partitionId: 3, triggerType: "on_create", orgId: "fake-org" });
    assert.equal(f.posts.length, 1);
    assert.equal((f.posts[0] as { templateCode: string }).templateCode, "B");
    const logs = f.failedLogs();
    assert.equal(logs.length, 1);
    assert.match(logs[0].resultMessage, /발송 준비 중 오류/);
});

test("UX-175: 대기 중 후속은 연결이 꺼져 있으면 발송 0회·큐 failed·중단 사유 이력, 다음 단계 미예약", async t => {
    const followupConfig = [{ templateCode: "F1", delayHours: 1 }, { templateCode: "F2", delayHours: 2 }];
    const f = await fixture(t, {
        links: [{ ...baseLink, isActive: 0, followupConfig }],
        parentLog: [{ recordId: 11 }],
    });
    const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };
    await f.automation.processFollowupItem({ id: 55, parentLogId: 100, templateLinkId: 7, orgId: "fake-org", sendAt: new Date(), status: "processing", stepIndex: 0, processedAt: null, createdAt: new Date() }, stats);
    assert.equal(f.posts.length, 0);
    assert.equal(stats.failed, 1);
    assert.equal((f.calls.find(c => c.op === "update" && c.table === "alimtalk_followup_queue")?.set as { status: string }).status, "failed");
    assert.equal(f.calls.filter(c => c.op === "insert" && c.table === "alimtalk_followup_queue").length, 0);
    const logs = f.failedLogs();
    assert.equal(logs.length, 1);
    assert.match(logs[0].resultMessage, /비활성화되어 후속 발송을 중단/);
});

test("UX-175: 활성 연결의 후속은 정상 발송하고 다음 단계를 예약한다", async t => {
    const followupConfig = [{ templateCode: "F1", delayHours: 1 }, { templateCode: "F2", delayHours: 2 }];
    const f = await fixture(t, { links: [{ ...baseLink, followupConfig }], parentLog: [{ recordId: 11 }], records: [record({ phone: "01000000001" })] });
    const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };
    await f.automation.processFollowupItem({ id: 56, parentLogId: 100, templateLinkId: 7, orgId: "fake-org", sendAt: new Date(), status: "processing", stepIndex: 0, processedAt: null, createdAt: new Date() }, stats);
    assert.equal(f.posts.length, 1);
    assert.equal((f.posts[0] as { templateCode: string }).templateCode, "F1");
    assert.equal(stats.sent, 1);
    assert.equal(f.calls.filter(c => c.op === "insert" && c.table === "alimtalk_followup_queue").length, 1);
});

test("UX-177: 반복 — 빈 중단 조건은 계속 반복, 충족 조건은 완료, 최대 횟수에서 완료", async t => {
    const cases = [
        { name: "빈 중단 조건", stop: { field: "", operator: "eq", value: "" }, data: { phone: "01000000001" }, repeatCount: 0, posts: 1, status: "pending" },
        { name: "조건 충족", stop: { field: "stage", operator: "eq", value: "계약" }, data: { phone: "01000000001", stage: "계약" }, repeatCount: 0, posts: 0, status: "completed" },
        { name: "조건 미충족", stop: { field: "stage", operator: "eq", value: "계약" }, data: { phone: "01000000001", stage: "상담" }, repeatCount: 0, posts: 1, status: "pending" },
        { name: "최대 횟수", stop: { field: "", operator: "eq", value: "" }, data: { phone: "01000000001" }, repeatCount: 2, posts: 1, status: "completed" },
    ];
    for (const c of cases) await t.test(c.name, async t => {
        const f = await fixture(t, {
            links: [{ ...baseLink, repeatConfig: { intervalHours: 24, maxRepeat: 3, stopCondition: c.stop } }],
            queue: [{ id: 9, templateLinkId: 7, recordId: 11, orgId: "fake-org", repeatCount: c.repeatCount, nextRunAt: new Date(), status: "pending" }],
            records: [record(c.data)],
        });
        await f.automation.processRepeatQueue();
        assert.equal(f.posts.length, c.posts);
        const update = f.calls.filter(x => x.op === "update" && x.table === "alimtalk_automation_queue").at(-1);
        assert.equal((update?.set as { status: string }).status, c.status);
    });
});

test("UX-254: 대량 가져오기 알림톡은 연결을 한 번 읽고 5건씩 순차 처리 — 동시 공급자 호출 5건 이하, 발송+실패 = 대상 수", async t => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { processAutoTriggerBatch } = await import("./alimtalk-automation");
    let linkListQueries = 0, inFlight = 0, maxInFlight = 0, posts = 0;
    const { calls } = installFakeDb(t, db, (call: FakeCall) => {
        if (call.op === "select" && call.table === "alimtalk_configs") return [{ appKey: "fake", secretKey: "fake" }];
        if (call.op === "select" && call.table === "alimtalk_template_links") {
            if (call.sql.includes('"trigger_type"')) linkListQueries++;
            return [baseLink];
        }
        if (call.op === "insert" && call.table === "alimtalk_send_logs") return (Array.isArray(call.values) ? call.values : [call.values]).map((_, i) => ({ id: 100 + i }));
        return [];
    });
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
        if (init?.method !== "POST") return Response.json({ header, template: { templateContent: "가상 본문" } });
        posts++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        const { recipientList } = JSON.parse(String(init.body)) as { recipientList: Array<{ recipientNo: string }> };
        return Response.json({ header, message: { requestId: "fake", sendResults: [{ recipientNo: recipientList[0].recipientNo, recipientSeq: 1, resultCode: 0 }] } });
    });
    // 12건 중 2건은 번호 없음 → 공급자 호출 없이 실패 이력
    const list = Array.from({ length: 12 }, (_, i) => ({ id: 200 + i, orgId: "fake-org", partitionId: 3, data: i < 2 ? {} : { phone: `0100000${String(i).padStart(4, "0")}` } }));
    const stats = await processAutoTriggerBatch(list as never, { partitionId: 3, orgId: "fake-org" }, { batchDelayMs: 0 });
    assert.equal(stats.processed, 12);
    assert.equal(linkListQueries, 1);
    assert.ok(maxInFlight <= 5, `동시 ${maxInFlight}건`);
    assert.equal(posts, 10);
    const failed = calls.filter(c => c.op === "insert" && c.table === "alimtalk_send_logs")
        .flatMap(c => (Array.isArray(c.values) ? c.values : [c.values]) as Array<{ status: string }>).filter(v => v.status === "failed");
    assert.equal(failed.length, 2);
    assert.equal(posts + failed.length, 12);
});
