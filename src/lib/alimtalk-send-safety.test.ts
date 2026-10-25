import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { installFakeDb, isolateEnv, type FakeCall } from "./auth-fake-db.test-helper";

const header = { isSuccessful: true, resultCode: 0, resultMessage: "접수" };
const phones = ["01000000001", "01000000002"];
const input = { orgId: "fake-org", senderKey: "fake-sender", templateCode: "fake-template",
    recipients: phones.map((phoneNumber, i) => ({ phoneNumber, recordId: i + 1, templateLinkId: 7, partitionId: 3 })) };

async function fixture(t: TestContext, options: { beforeInsertFailure?: boolean; updateFailure?: boolean; active?: boolean; unknown?: boolean; content?: string;
    provider?: () => unknown | Promise<unknown> } = {}) {
    isolateEnv(t);
    const { db } = await import("./db");
    const { sendAlimtalkForOrg } = await import("./alimtalk/send-service");
    let posts = 0;
    const order: string[] = [];
    const { calls } = installFakeDb(t, db, (call: FakeCall) => {
        if (call.op === "select" && call.table === "alimtalk_configs") return [{ appKey: "fake", secretKey: "fake" }];
        if (call.op === "select" && call.table === "alimtalk_template_links") return [{ isActive: options.active === false ? 0 : 1 }];
        if (call.op === "select" && call.table === "alimtalk_send_logs") return options.unknown ? [{ id: 99 }] : [];
        if (call.op === "insert" && call.table === "alimtalk_send_logs") {
            order.push("persist");
            if (options.beforeInsertFailure) return new Error("fake persistence failure");
            return (Array.isArray(call.values) ? call.values : [call.values]).map((_, i) => ({ id: 100 + i }));
        }
        if (call.op === "update" && options.updateFailure) return new Error("fake result persistence failure");
        return [];
    });
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
        if (init?.method !== "POST") return Response.json({ header, template: { templateContent: options.content ?? "가상 본문", templateName: "가상" } });
        posts++; order.push("post");
        const result = options.provider ? await options.provider() : { header, message: { requestId: "fake-request", sendResults: phones.map((recipientNo, i) => ({ recipientNo, recipientSeq: i + 1, resultCode: 0, resultMessage: "접수" })) } };
        return Response.json(result);
    });
    return { send: sendAlimtalkForOrg, calls, order, posts: () => posts };
}

test("UX-251: 이력 준비 실패에는 공급자 발송이 0회", async t => {
    const f = await fixture(t, { beforeInsertFailure: true });
    await assert.rejects(f.send(input)); assert.equal(f.posts(), 0);
});
test("UX-174·251: 발송 전 이력, 접수는 pending, 최종 성공으로 기록하지 않음", async t => {
    const f = await fixture(t), result = await f.send(input);
    assert.deepEqual(f.order, ["persist", "post"]); assert(result.ok);
    assert.equal(result.data.successCount, 2); assert(result.data.results.every(r => r.status === "pending"));
    const pre = f.calls.find(c => c.op === "insert")!.values as { status: string }[];
    assert(pre.every(r => r.status === "unknown"));
});
test("UX-251: 접수 후 응답 유실은 unknown이며 POST를 재시도하지 않음", async t => {
    const f = await fixture(t, { provider: () => { throw new Error("fake response lost"); } });
    const result = await f.send(input); assert(result.ok);
    assert.equal(f.posts(), 1); assert.equal(result.data.unknownCount, 2); assert.equal(result.data.failCount, 0);
});
test("UX-251: 접수 후 DB 갱신 실패도 앞선 접수를 전체 실패로 되돌리지 않음", async t => {
    const f = await fixture(t, { updateFailure: true }), result = await f.send(input); assert(result.ok);
    assert.equal(f.posts(), 1); assert.equal(result.data.successCount, 2); assert.match(result.data.warning!, /이력 갱신/);
});
test("UX-174: 응답 순서 변경·개별 실패를 번호에 맞추고 누락 결과는 unknown", async t => {
    const f = await fixture(t, { provider: () => ({ header, message: { requestId: "fake", sendResults: [
        { recipientNo: phones[1], recipientSeq: 2, resultCode: -2018, resultMessage: "거절" },
    ] } }) });
    const result = await f.send(input); assert(result.ok);
    assert.equal(result.data.results[0].status, "unknown"); assert.equal(result.data.results[1].status, "failed");
    assert.equal(result.data.failCount, 1); assert.equal(result.data.unknownCount, 1);
});
test("UX-174: 공급자 전체 거절과 서버 오류는 실패 확정/미확인을 구분", async t => {
    for (const code of [-1000, -9999, -1005, -1, 408, 503]) await t.test(String(code), async t => {
        const f = await fixture(t, { provider: () => ({ header: { isSuccessful: false, resultCode: code, resultMessage: "가상" } }) });
        const result = await f.send(input); assert(result.ok);
        assert(result.data.results.every(r => r.status === (code === -1000 ? "failed" : "unknown"))); assert.equal(f.posts(), 1);
    });
});
test("UX-253: 본문 변수 누락은 공급자 호출 전 거절", async t => {
    const f = await fixture(t, { content: "안녕하세요 #{이름}" }), result = await f.send(input);
    assert(!result.ok); assert.equal(f.posts(), 0); assert.match(result.error, /변수/);
});
test("UX-175·251: 꺼진 자동 규칙과 과거 unknown은 시간과 관계없이 발송 0회", async t => {
    for (const options of [{ active: false }, { unknown: true }]) await t.test(JSON.stringify(options), async t => {
        const f = await fixture(t, options), result = await f.send({ ...input, triggerType: "followup" });
        assert(!result.ok); assert.equal(f.posts(), 0);
    });
});

// DB 자체를 실행하지 않는 직렬 트랜잭션 fixture. 잠금 내 검사/이력과 공급자 호출 순서를 검증한다.
test("동시 자동 호출 2개: 한 번 접수 또는 응답 유실 후에도 공급자 호출 1회", async t => {
    for (const lost of [false, true]) await t.test(lost ? "응답 유실" : "정상 접수", async t => {
        isolateEnv(t);
        const { db } = await import("./db");
        const { sendAlimtalkForOrg } = await import("./alimtalk/send-service");
        let persisted = false, posts = 0;
        let tail = Promise.resolve();
        const { calls } = installFakeDb(t, db, c => {
            if (c.table === "alimtalk_configs") return [{ appKey: "fake", secretKey: "fake" }];
            if (c.table === "alimtalk_template_links") return [{ isActive: 1, preventDuplicate: 0 }];
            if (c.op === "select" && c.table === "alimtalk_send_logs") return persisted ? [{ id: 1 }] : [];
            if (c.op === "insert" && c.table === "alimtalk_send_logs") { persisted = true; return [{ id: 1 }]; }
            return [];
        });
        t.mock.method(db, "transaction", async (fn: (tx: typeof db) => Promise<unknown>) => {
            const previous = tail;
            let release!: () => void;
            tail = new Promise<void>(resolve => { release = resolve; });
            await previous;
            try { return await fn(db); } finally { release(); }
        });
        t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
            if (init?.method !== "POST") return Response.json({ header, template: { templateContent: "가상" } });
            posts++;
            if (lost) throw Error("fake response lost");
            return Response.json({ header, message: { requestId: "fake", sendResults: [{ recipientNo: phones[0], recipientSeq: 1, resultCode: 0 }] } });
        });
        const request = { ...input, triggerType: "auto", recipients: [input.recipients[0]] };
        const results = await Promise.all([sendAlimtalkForOrg(request), sendAlimtalkForOrg(request)]);
        assert.equal(posts, 1); assert.equal(results.filter(r => r.ok).length, 1);
        assert.equal(calls.filter(c => c.op === "insert").length, 1);
        assert.equal(calls.filter(c => c.op === "execute" && c.sql.includes("pg_advisory_xact_lock")).length, 2);
        const success = results.find(r => r.ok)!; assert(success.ok);
        assert.equal(success.data.unknownCount, lost ? 1 : 0);
        // 다음 회차에도 미확인 이력을 지우거나 재전송하지 않는다.
        const retry = await sendAlimtalkForOrg(request); assert(!retry.ok); assert.equal(posts, 1);
    });
});

test("같은 번호인 서로 다른 레코드의 결과를 임의로 성공 배정하지 않음", async t => {
    const f = await fixture(t, { provider: () => ({ header, message: { requestId: "fake", sendResults: [{ recipientNo: phones[0], recipientSeq: 1, resultCode: 0 }] } }) });
    const result = await f.send({ ...input, recipients: [input.recipients[0], { ...input.recipients[1], phoneNumber: phones[0] }] });
    assert(result.ok); assert.equal(result.data.unknownCount, 2); assert.equal(result.data.successCount, 0);
});

test("UX-174: 처리 중은 pending 유지, terminal COMPLETED만 배달 성공으로 갱신", async t => {
    isolateEnv(t);
    const { db } = await import("./db"), { generateToken } = await import("./auth");
    const { POST } = await import("../app/api/alimtalk/logs/sync/route");
    const { NextRequest } = await import("next/server");
    const { isMembershipLookup } = await import("./auth-fake-db.test-helper");
    const orgId = "00000000-0000-4000-8000-000000000001";
    for (const [messageStatus, resultCode, expected] of [["SENDING", "1000", undefined], ["COMPLETED", "1000", "sent"], ["FAILED", "3000", "failed"], ["CANCEL", "0", "failed"]] as const) await t.test(messageStatus, async t => {
        const { calls } = installFakeDb(t, db, c => {
            if (isMembershipLookup(c)) return [{ role: "admin", tokenVersion: 0, isSuperAdmin: 0 }];
            if (c.table === "alimtalk_configs") return [{ appKey: "fake", secretKey: "fake" }];
            if (c.op === "select" && c.table === "alimtalk_send_logs") return [{ id: 1, orgId, requestId: "fake", recipientSeq: 1, status: "pending" }];
            return [];
        });
        t.mock.method(globalThis, "fetch", async () => Response.json({ header, message: { messageStatus, resultCode, resultCodeName: "가상" } }));
        const token = generateToken({ userId: "00000000-0000-4000-8000-000000000002", orgId, role: "admin", tokenVersion: 0, name: "가상", email: "fake@example.test" });
        const response = await POST(new NextRequest("https://example.test/api/alimtalk/logs/sync", { method: "POST", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" }));
        assert.equal(response.status, 200);
        assert.equal((calls.find(c => c.op === "update")?.set as { status?: string } | undefined)?.status, expected);
    });
});

test("접수 뒤 잘못된 JSON 구조도 500 재시도 안내 대신 unknown으로 보존", async t => {
    for (const sendResults of [{ invalid: true }, [null, { resultCode: 0 }]]) await t.test(JSON.stringify(sendResults), async t => {
        const f = await fixture(t, { provider: () => ({ header, message: { requestId: 123, sendResults } }) });
        const result = await f.send(input); assert(result.ok); assert.equal(result.data.unknownCount, 2); assert.equal(f.posts(), 1);
    });
});
