import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";

const orgId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
async function fixture(t: TestContext, options: { lostResponse?: boolean; logFailure?: boolean; foreign?: boolean; missingVariable?: boolean } = {}) {
    isolateEnv(t, { NEXT_PUBLIC_BASE_URL: "https://example.test" });
    const { db } = await import("./db"), { generateToken } = await import("./auth");
    const { POST } = await import("../app/api/email/send/route");
    let posts = 0, nextLog = 0;
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: "admin", tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.table === "email_configs") return [{ fromEmail: "sender@example.test", fromName: "가상", appKey: "fake", secretKey: "fake", isActive: 1 }];
        if (c.op === "select" && c.table === "email_template_links") return [{ email_template_links: { id: 7, partitionId: 3, emailTemplateId: 9, recipientField: "email", variableMappings: {} }, workspaces: { id: 2 } }];
        if (c.op === "select" && c.table === "partitions") return [{ partition: { id: 3, workspaceId: 2 }, workspace: { id: 2, orgId } }];
        if (c.op === "select" && c.table === "workspaces") return [{ id: 2, orgId }];
        if (c.op === "select" && c.table === "email_templates") return [{ id: 9, subject: "가상 제목", htmlBody: options.missingVariable ? "##이름##" : "가상 본문", useUnsubscribe: false }];
        if (c.op === "select" && c.table === "records") {
            assert(c.sql.includes('"records"."partition_id"'));
            return (options.foreign ? [1, 2] : [1, 2, 3]).map(id => ({ id, partitionId: 3, orgId, integratedCode: `FAKE-${id}`, data: { email: `recipient-${id}@example.test` } }));
        }
        if (c.op === "insert" && c.table === "email_send_logs") return [{ id: ++nextLog }];
        if (c.op === "update" && c.table === "email_send_logs" && c.params.includes(2) && options.logFailure) return new Error("fake update failure");
        return [];
    });
    t.mock.method(globalThis, "fetch", async () => {
        posts++;
        if (posts === 2 && options.lostResponse) throw new Error("fake accepted then disconnected");
        return Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "접수" }, body: { data: { requestId: `fake-${posts}`, results: [{ resultCode: 0 }] } } });
    });
    const token = generateToken({ userId, orgId, name: "가상", email: "staff@example.test", role: "admin", tokenVersion: 0 });
    const run = () => POST(new NextRequest("https://example.test/api/email/send", { method: "POST", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ templateLinkId: 7, recordIds: [1, 2, 3] }) }));
    return { run, calls, posts: () => posts };
}
test("UX-154: 3건 중 2번째 응답 유실도 1·3번째 결과를 유지하고 자동 재발송 없음", async t => {
    const f = await fixture(t, { lostResponse: true }), response = await f.run(), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.data.successCount, 2); assert.equal(result.data.unknownCount, 1);
    assert.equal(result.data.errors[0].recordId, 2); assert.equal(f.posts(), 3);
    assert(f.calls.some(c => c.op === "update" && (c.set as { status?: string })?.status === "unknown"));
});
test("UX-154: 접수 뒤 로그 갱신 실패도 전체 500으로 되돌리지 않음", async t => {
    const f = await fixture(t, { logFailure: true }), response = await f.run(), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.data.successCount, 2); assert.equal(result.data.unknownCount, 1); assert.equal(f.posts(), 3);
});
test("이메일도 연결 파티션 외 대상 혼합 시 전체 발송 0회", async t => {
    const f = await fixture(t, { foreign: true }), response = await f.run();
    assert.equal(response.status, 404); assert.equal(f.posts(), 0);
});
test("UX-163: 미치환 변수가 있으면 공급자 호출 없이 대상별 사유", async t => {
    const f = await fixture(t, { missingVariable: true }), response = await f.run(), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.data.failCount, 3); assert.equal(f.posts(), 0);
    assert.match(result.data.errors[0].error, /변수 매핑/);
});

test("UX-161: 비활성 템플릿/AI 규칙의 후속은 취소 사유를 남기고 발송·AI 호출 0회", async t => {
    isolateEnv(t);
    const { db, queryClient } = await import("./db");
    const { processEmailFollowupQueue } = await import("./email-followup");
    for (const source of ["template", "ai"]) await t.test(source, async t => {
        let picked = false, sends = 0;
        const { calls } = installFakeDb(t, db, c => {
            if (c.op === "execute" && c.sql.includes("RETURNING id, parent_log_id")) {
                if (picked) return []; picked = true;
                return [{ id: 1, parent_log_id: 2, source_type: source, source_id: 3, org_id: orgId, step_index: 0 }];
            }
            if (c.op === "select" && c.table === "email_send_logs" && !c.sql.includes("parent_log_id")) return [{ id: 2, orgId, recordId: null, partitionId: null, recipientEmail: "fake@example.test", status: "sent" }];
            if (c.op === "select" && ["email_template_links", "email_auto_personalized_links"].includes(c.table ?? "")) return [{ id: 3, isActive: 0, isDraft: 0, followupConfig: [{ delayDays: 1 }] }];
            return [];
        });
        const connection = Object.assign(async () => [{ acquired: true }], { release() {} });
        t.mock.method(queryClient, "reserve", async () => connection as never);
        t.mock.method(globalThis, "fetch", async () => { sends++; throw Error("must not send"); });
        const stats = await processEmailFollowupQueue();
        assert.equal(sends, 0); assert.equal(stats.stopped, 1);
        assert(calls.some(c => c.op === "update" && (c.set as { stopReason?: string })?.stopReason === "rule_inactive"));
    });
});

test("UX-139: 활성/중지/초안 수정 상태 전이", async t => {
    isolateEnv(t);
    const { db } = await import("./db"), { generateToken } = await import("./auth");
    const { PUT } = await import("../app/api/email/auto-personalized/[id]/route");
    const token = generateToken({ userId, orgId, name: "가상", email: "staff@example.test", role: "admin", tokenVersion: 0 });
    for (const [active, draft, body, expected] of [
        [0, 0, { prompt: "수정", isDraft: 0 }, undefined], [1, 0, { prompt: "수정", isDraft: 0 }, undefined],
        [0, 1, { prompt: "수정", isDraft: 1 }, 0], [0, 1, { isDraft: 0 }, 1],
        [0, 1, { isDraft: 0, isActive: 0 }, 0], [1, 0, { isDraft: 1 }, 0],
    ] as const) await t.test(JSON.stringify([active, draft, body]), async t => {
        const { calls } = installFakeDb(t, db, c => {
            if (isMembershipLookup(c)) return [{ role: "admin", tokenVersion: 0, isSuperAdmin: 0 }];
            if (c.op === "select" && c.table === "email_auto_personalized_links") return [{ id: 7, orgId, partitionId: 3, isActive: active, isDraft: draft }];
            if (c.op === "update") return [{ id: 7 }];
            return [];
        });
        const response = await PUT(new NextRequest("https://example.test/api/email/auto-personalized/7", { method: "PUT", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "7" }) });
        assert.equal(response.status, 200);
        const update = calls.find(c => c.op === "update")!.set as { isActive?: number };
        assert.equal(update.isActive, expected);
    });
});

test("UX-194: 중단된 attempts 1/2/3과 접수 흔적 대조, 미확인 자동 재발송 0회", async t => {
    isolateEnv(t);
    const { db, queryClient } = await import("./db");
    const { processEmailSendQueue } = await import("./email-send-queue");
    const createdAt = new Date("2026-10-20T00:00:00Z"), sentAt = new Date("2026-10-20T01:00:00Z");
    const { calls } = installFakeDb(t, db, c => {
        if (c.op === "select" && c.table === "email_send_queue") return [1, 2, 3, 4, 5, 6].map(id => ({ id, recordId: id, orgId, attempts: id <= 3 ? id : 1, createdAt }));
        if (c.op === "select" && c.table === "email_prepared_sends") return [{ queueId: 4, status: "sending" }, { queueId: 5, status: "uncertain" }];
        if (c.op === "select" && c.table === "email_send_logs") return [{ orgId, recordId: 6, status: "pending", requestId: null, sentAt }];
        return [];
    });
    const connection = Object.assign(async () => [{ acquired: true }], { release() {} });
    t.mock.method(queryClient, "reserve", async () => connection as never);
    let externalCalls = 0;
    t.mock.method(globalThis, "fetch", async () => { externalCalls++; throw Error("must not send"); });
    const stats = await processEmailSendQueue();
    assert.equal(stats.reclaimed, 6); assert.equal(externalCalls, 0);
    const writes = calls.filter(c => c.op === "update" && c.table === "email_send_queue");
    const pending = writes.filter(c => (c.set as { status: string }).status === "pending").flatMap(c => c.params.filter(x => typeof x === "number"));
    const failed = writes.filter(c => (c.set as { status: string }).status === "failed").flatMap(c => c.params.filter(x => typeof x === "number"));
    assert.deepEqual(pending, [1, 2]); assert.deepEqual(failed, [3, 4, 5, 6]);
    assert(writes.every(c => (c.set as { lockedAt: unknown }).lockedAt === null));
    assert(writes.some(c => (c.set as { lastError: string }).lastError.includes("접수 결과 확인 필요")));
});

test("AI 자동 메일의 시간 제한 없는 pending/unknown 이력은 AI·공급자를 다시 호출하지 않음", async t => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { processAutoPersonalizedEmail } = await import("./auto-personalized-email");
    installFakeDb(t, db, c => {
        if (c.op === "select" && c.table === "email_auto_personalized_links") return [{ id: 7, isActive: 1, partitionId: 3 }];
        if (c.op === "select" && c.table === "email_send_logs") {
            assert(!c.sql.includes("sent_at"), "미확인 차단은 1시간 쿨다운으로 만료하지 않는다");
            return [{ id: 99 }];
        }
        return [];
    });
    let externalCalls = 0;
    t.mock.method(globalThis, "fetch", async () => { externalCalls++; throw Error("must not send"); });
    const result = await processAutoPersonalizedEmail({ record: { id: 1, data: {}, createdAt: new Date(), updatedAt: new Date() } as never, partitionId: 3, orgId, triggerType: "on_create" });
    assert.deepEqual(result.outcomes, [{ kind: "skipped", linkId: 7, reason: "delivery_uncertain" }]);
    assert.equal(externalCalls, 0);
});

test("후속 메일은 부모에 남은 접수 이력이 있으면 크래시 후에도 재발송하지 않음", async t => {
    isolateEnv(t);
    const { db, queryClient } = await import("./db");
    const { processEmailFollowupQueue } = await import("./email-followup");
    let picked = false;
    const { calls } = installFakeDb(t, db, c => {
        if (c.op === "execute" && c.sql.includes("RETURNING id, parent_log_id")) {
            if (picked) return []; picked = true; return [{ id: 1, parent_log_id: 2, source_type: "template", source_id: 3, org_id: orgId }];
        }
        if (c.op === "select" && c.table === "email_send_logs") return c.sql.includes("parent_log_id") ? [{ id: 99 }] : [{ id: 2, orgId, partitionId: null, status: "sent" }];
        return [];
    });
    const connection = Object.assign(async () => [{ acquired: true }], { release() {} });
    t.mock.method(queryClient, "reserve", async () => connection as never);
    let externalCalls = 0; t.mock.method(globalThis, "fetch", async () => { externalCalls++; throw Error("must not send"); });
    const stats = await processEmailFollowupQueue();
    assert.equal(stats.uncertain, 1); assert.equal(externalCalls, 0);
    assert(calls.some(c => c.op === "update" && (c.set as { status?: string }).status === "uncertain"));
});

test("템플릿 자동 메일 -9999 응답은 unknown 보존, 다음 트리거에서 발송 0회", async t => {
    isolateEnv(t, { NEXT_PUBLIC_BASE_URL: "https://example.test" });
    const { db } = await import("./db");
    const { processEmailAutoTrigger } = await import("./email-automation");
    let status = "", posts = 0;
    installFakeDb(t, db, c => {
        if (c.op === "select" && c.table === "email_template_links") return [{ id: 7, partitionId: 3, emailTemplateId: 9, recipientField: "email", isActive: 1 }];
        if (c.op === "select" && c.table === "email_send_logs") return c.sql.includes("sent_at") ? [] : status ? [{ id: 1 }] : [];
        if (c.table === "email_configs") return [{ fromEmail: "sender@example.test", appKey: "fake", secretKey: "fake", isActive: 1 }];
        if (c.table === "email_templates") return [{ id: 9, subject: "가상", htmlBody: "가상", useUnsubscribe: false }];
        if (c.table === "partitions") return [{ workspaceId: 2 }];
        if (c.table === "workspaces") return [{ orgId, id: 2 }];
        if (c.op === "insert" && c.table === "email_send_logs") { status = "pending"; return [{ id: 1 }]; }
        if (c.op === "update" && c.table === "email_send_logs") status = (c.set as { status: string }).status;
        return [];
    });
    t.mock.method(globalThis, "fetch", async () => { posts++; return Response.json({ header: { isSuccessful: false, resultCode: -9999, resultMessage: "가상 내부 오류" } }); });
    const request = { record: { id: 1, data: { email: "recipient@example.test" } } as never, orgId, partitionId: 3, triggerType: "on_create" as const };
    await processEmailAutoTrigger(request); assert.equal(posts, 1); assert.equal(status, "unknown");
    await processEmailAutoTrigger(request); assert.equal(posts, 1); assert.equal(status, "unknown");
});
