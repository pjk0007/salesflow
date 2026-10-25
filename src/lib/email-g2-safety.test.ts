// G2 이메일 묶음 — UX-154·156·157·161·162·163.
// 실제 DB·NHN을 쓰지 않는다: db는 가상(auth-fake-db.test-helper), fetch는 가로채 호출 횟수만 센다.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall, type Responder } from "./auth-fake-db.test-helper";

const orgId = "00000000-0000-4000-8000-0000000000a1";
const userId = "00000000-0000-4000-8000-0000000000a2";

async function staff(t: TestContext, role: "owner" | "admin" | "member" = "admin") {
    isolateEnv(t, { NEXT_PUBLIC_BASE_URL: "https://example.test" });
    const { db, queryClient } = await import("./db");
    const { generateToken } = await import("./auth");
    const token = generateToken({ userId, orgId, name: "가상", email: "staff@example.test", role, membershipId: 71, tokenVersion: 0 });
    const request = (url: string, method: string, body?: unknown) =>
        new NextRequest(url, {
            method,
            headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    const membership: Responder = (c) => (isMembershipLookup(c) ? [{ role, membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }] : undefined);
    return { db, queryClient, request, membership };
}

const chain = (...responders: Responder[]): Responder => (c) => {
    for (const r of responders) {
        const result = r(c);
        if (result !== undefined) return result;
    }
    return [];
};
const updatesOf = (calls: FakeCall[], table: string) => calls.filter((c) => c.op === "update" && c.table === table);

test("UX-154: 2번째 레코드의 발송 전 오류(로그 기록 실패)는 그 건만 실패로, 앞뒤 건은 발송·200", async (t) => {
    const { db, request, membership } = await staff(t);
    const { POST } = await import("../app/api/email/send/route");
    let inserts = 0, posts = 0;
    installFakeDb(t, db, chain(membership, (c) => {
        if (c.table === "email_configs") return [{ fromEmail: "sender@example.test", fromName: "가상", appKey: "fake", secretKey: "fake", isActive: 1 }];
        if (c.op === "select" && c.table === "email_template_links") return [{ email_template_links: { id: 7, partitionId: 3, emailTemplateId: 9, recipientField: "email", variableMappings: {} }, workspaces: { id: 2 } }];
        if (c.op === "select" && c.table === "partitions") return [{ partition: { id: 3, workspaceId: 2 }, workspace: { id: 2, orgId } }];
        if (c.op === "select" && c.table === "email_templates") return [{ id: 9, subject: "가상 제목", htmlBody: "가상 본문", useUnsubscribe: false }];
        if (c.op === "select" && c.table === "workspaces") return [{ id: 2, orgId }];
        if (c.op === "select" && c.table === "records") return [1, 2, 3].map((id) => ({ id, partitionId: 3, orgId, integratedCode: `FAKE-${id}`, data: { email: `r${id}@example.test` } }));
        if (c.op === "insert" && c.table === "email_send_logs") return ++inserts === 2 ? new Error("가상 DB 오류") : [{ id: inserts }];
        return undefined;
    }));
    t.mock.method(globalThis, "fetch", async () => {
        posts++;
        return Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "" }, body: { data: { requestId: `req-${posts}`, results: [{ resultCode: 0 }] } } });
    });
    const res = await POST(request("https://example.test/api/email/send", "POST", { templateLinkId: 7, recordIds: [1, 2, 3] }));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.successCount, 2);
    assert.equal(body.data.failCount, 1);
    assert.equal(body.data.unknownCount, 0);
    assert.equal(body.data.errors[0].recordId, 2);
    assert.match(body.data.errors[0].error, /보내지 않았습니다/);
    assert.equal(posts, 2, "실패한 2번째는 NHN에 보내지 않고 3번째는 계속 보낸다");
});

test("UX-156: 연결 수정에서 템플릿 교체를 저장하고, 다른 조직 템플릿은 400·저장 없음", async (t) => {
    const ownLink: Responder = (c) =>
        c.op === "select" && c.table === "email_template_links" ? [{ email_template_links: { id: 5, emailTemplateId: 1 }, partitions: {}, workspaces: { orgId } }] : undefined;
    for (const [label, ownedIds, expected] of [
        ["자기 조직 템플릿 B로 교체", [2], 200],
        ["다른 조직 템플릿", [], 400],
    ] as const) {
        await t.test(label, async (t) => {
            const { db, request, membership } = await staff(t);
            const { PUT } = await import("../app/api/email/template-links/[id]/route");
            const { calls } = installFakeDb(t, db, chain(membership, ownLink, (c) => {
                if (c.op === "select" && c.table === "email_templates") return ownedIds.map((id) => ({ id }));
                if (c.op === "update") return [{ id: 5, emailTemplateId: 2 }];
                return undefined;
            }));
            const res = await PUT(request("https://example.test/api/email/template-links/5", "PUT", { name: "규칙", emailTemplateId: 2 }), { params: Promise.resolve({ id: "5" }) });
            assert.equal(res.status, expected);
            const updates = updatesOf(calls, "email_template_links");
            if (expected === 200) {
                assert.equal((updates[0].set as { emailTemplateId?: number }).emailTemplateId, 2);
                const ownership = calls.find((c) => c.op === "select" && c.table === "email_templates");
                assert(ownership && ownership.params.includes(orgId) && ownership.params.includes(2), "조직 조건으로 소유 확인");
            } else {
                assert.equal(updates.length, 0);
                assert.equal((await res.json()).error, "선택한 이메일 템플릿을 찾을 수 없습니다.");
            }
        });
    }
    await t.test("템플릿을 보내지 않은 저장은 템플릿 칸을 바꾸지 않는다 (기존 동작)", async (t) => {
        const { db, request, membership } = await staff(t);
        const { PUT } = await import("../app/api/email/template-links/[id]/route");
        const { calls } = installFakeDb(t, db, chain(membership, ownLink, (c) => (c.op === "update" ? [{ id: 5 }] : undefined)));
        const res = await PUT(request("https://example.test/api/email/template-links/5", "PUT", { name: "새 이름" }), { params: Promise.resolve({ id: "5" }) });
        assert.equal(res.status, 200);
        assert.equal("emailTemplateId" in (updatesOf(calls, "email_template_links")[0].set as object), false);
        assert.equal(calls.some((c) => c.op === "select" && c.table === "email_templates"), false);
    });
});

test("UX-157: 연결이 쓰는 템플릿(첫 메일·후속 단계)은 409, 안 쓰는 템플릿만 삭제", async (t) => {
    const links = [
        { id: 1, name: "환영 메일", emailTemplateId: 10, followupConfig: null },
        { id: 2, name: "재방문 유도", emailTemplateId: 11, followupConfig: [{ delayDays: 3, onNotClicked: { templateId: 20 } }] },
    ];
    for (const [label, templateId, status] of [
        ["첫 메일로 쓰는 템플릿", 10, 409],
        ["후속 단계로 쓰는 템플릿", 20, 409],
        ["쓰지 않는 템플릿", 30, 200],
    ] as const) {
        await t.test(label, async (t) => {
            const { db, request, membership } = await staff(t);
            const { DELETE } = await import("../app/api/email/templates/[id]/route");
            const { calls } = installFakeDb(t, db, chain(membership, (c) => {
                if (c.op === "select" && c.table === "email_template_links") {
                    assert(c.params.includes(orgId), "이 조직 연결만 센다");
                    return links;
                }
                if (c.op === "delete") return [{ id: templateId }];
                return undefined;
            }));
            const res = await DELETE(request(`https://example.test/api/email/templates/${templateId}`, "DELETE"), { params: Promise.resolve({ id: String(templateId) }) });
            assert.equal(res.status, status);
            const deletes = calls.filter((c) => c.op === "delete");
            if (status === 409) {
                assert.equal(deletes.length, 0);
                assert.match((await res.json()).error, /이 템플릿을 쓰는 연결 1개가 있습니다\('(환영 메일|재방문 유도)'\)/);
            } else assert.equal(deletes.length, 1);
        });
    }
});

/** 후속 대기열 한 줄을 처리하는 가상 환경. respond로 표별 응답을 덧붙인다 */
async function followupRun(t: TestContext, item: Record<string, unknown>, respond: Responder) {
    isolateEnv(t, { NEXT_PUBLIC_BASE_URL: "https://example.test" });
    const { db, queryClient } = await import("./db");
    const { processEmailFollowupQueue } = await import("./email-followup");
    let picked = false;
    const { calls } = installFakeDb(t, db, chain((c) => {
        if (c.op === "execute" && c.sql.includes("RETURNING id, parent_log_id")) {
            if (picked) return [];
            picked = true;
            return [{ id: 1, parent_log_id: 2, source_id: 3, org_id: orgId, step_index: 0, stop_reason: null, ...item }];
        }
        return undefined;
    }, respond));
    const connection = Object.assign(async () => [{ acquired: true }], { release() {} });
    t.mock.method(queryClient, "reserve", async () => connection as never);
    let sends = 0;
    t.mock.method(globalThis, "fetch", async () => {
        sends++;
        return Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "" }, body: { data: { requestId: `req-${sends}`, results: [{ resultCode: 0 }] } } });
    });
    const stats = await processEmailFollowupQueue();
    const queueUpdates = updatesOf(calls, "email_followup_queue").map((c) => c.set as { status?: string; stopReason?: string | null; checkAt?: Date });
    return { stats, calls, queueUpdates, sends: () => sends };
}

const parentLog: Responder = (c) =>
    c.op === "select" && c.table === "email_send_logs" && !c.sql.includes("parent_log_id")
        ? [{ id: 2, orgId, recordId: 8, partitionId: null, recipientEmail: "lead@example.test", status: "sent", senderProfileId: null }]
        : undefined;
const templateLink = (mappings: Record<string, string>, isActive = 1): Responder => (c) =>
    c.op === "select" && c.table === "email_template_links"
        ? [{ id: 3, partitionId: 4, isActive, variableMappings: mappings, followupConfig: [{ delayDays: 1, onClicked: { templateId: 12 }, onNotClicked: { templateId: 12 } }] }]
        : undefined;
const followupTemplate: Responder = (c) =>
    c.op === "select" && c.table === "email_templates" ? [{ id: 12, subject: "##이름##님", htmlBody: "<p>##회사명##</p>", useUnsubscribe: false }] : undefined;
const sendEnv: Responder = (c) => {
    if (c.table === "email_configs") return [{ fromEmail: "sender@example.test", fromName: "가상", appKey: "fake", secretKey: "fake", isActive: 1 }];
    if (c.op === "select" && c.table === "records") return [{ id: 8, data: { name: "홍길동", company: "가상회사" } }];
    if (c.op === "select" && c.table === "partitions") return [{ workspaceId: 2 }];
    if (c.op === "select" && c.table === "workspaces") return [{ id: 2, orgId }];
    if (c.op === "insert" && c.table === "email_send_logs") return [{ id: 50 }];
    return undefined;
};

test("UX-163: 후속 템플릿 변수가 연결 매핑에 없으면 보내지 않고 사유 'unmapped_variable'", async (t) => {
    const run = await followupRun(t, { source_type: "template" }, chain(parentLog, templateLink({ "##이름##": "name" }), followupTemplate, sendEnv));
    assert.equal(run.sends(), 0);
    assert.equal(run.stats.skipped, 1);
    assert.deepEqual(run.queueUpdates.at(-1), { ...run.queueUpdates.at(-1), status: "skipped", stopReason: "unmapped_variable" });
});

test("UX-163·161: 모든 변수를 매핑한 활성 규칙의 후속은 정상 발송(사유 없음)", async (t) => {
    const run = await followupRun(t, { source_type: "template" }, chain(parentLog, templateLink({ "##이름##": "name", "##회사명##": "company" }), followupTemplate, sendEnv));
    assert.equal(run.sends(), 1);
    assert.equal(run.stats.sent, 1);
    const last = run.queueUpdates.at(-1)!;
    assert.equal(last.status, "sent");
    assert.equal(last.stopReason, null);
});

test("UX-161: 비활성 규칙의 후속은 발송 0회, 'rule_inactive'로 취소", async (t) => {
    const run = await followupRun(t, { source_type: "template" }, chain(parentLog, templateLink({ "##이름##": "name", "##회사명##": "company" }, 0), followupTemplate, sendEnv));
    assert.equal(run.sends(), 0);
    assert.equal(run.queueUpdates.at(-1)!.status, "cancelled");
    assert.equal(run.queueUpdates.at(-1)!.stopReason, "rule_inactive");
});

test("UX-162: 발송 전 일시 오류 1회 → pending으로 미룸(표시 error_retry), 두 번째 오류 → 사유 'error'로 종료", async (t) => {
    const failing: Responder = (c) => (c.op === "select" && c.table === "email_template_links" ? new Error("가상 DB 연결 끊김") : undefined);
    await t.test("첫 오류", async (t) => {
        const run = await followupRun(t, { source_type: "template" }, chain(parentLog, failing));
        assert.equal(run.sends(), 0);
        assert.equal(run.stats.deferred, 1);
        const last = run.queueUpdates.at(-1)!;
        assert.equal(last.status, "pending");
        assert.equal(last.stopReason, "error_retry");
        assert(last.checkAt instanceof Date && last.checkAt.getTime() > Date.now());
    });
    await t.test("미룬 뒤 또 오류", async (t) => {
        const run = await followupRun(t, { source_type: "template", stop_reason: "error_retry" }, chain(parentLog, failing));
        assert.equal(run.sends(), 0);
        assert.equal(run.stats.cancelled, 1);
        assert.deepEqual([run.queueUpdates.at(-1)!.status, run.queueUpdates.at(-1)!.stopReason], ["cancelled", "error"]);
    });
    await t.test("미룬 뒤 정상이면 발송하고 표시를 지운다", async (t) => {
        const run = await followupRun(t, { source_type: "template", stop_reason: "error_retry" }, chain(parentLog, templateLink({ "##이름##": "name", "##회사명##": "company" }), followupTemplate, sendEnv));
        assert.equal(run.sends(), 1);
        assert.deepEqual([run.queueUpdates.at(-1)!.status, run.queueUpdates.at(-1)!.stopReason], ["sent", null]);
    });
});

test("UX-162: AI 후속의 토큰 한도·설정 없음은 사유를 남긴 건너뜀", async (t) => {
    const aiLink: Responder = (c) =>
        c.op === "select" && c.table === "email_auto_personalized_links"
            ? [{ id: 3, partitionId: 4, isActive: 1, isDraft: 0, model: null, followupConfig: [{ delayDays: 1, onClicked: { prompt: "가상" }, onNotClicked: { prompt: "가상" } }] }]
            : undefined;
    const run = await followupRun(t, { source_type: "ai" }, chain(parentLog, aiLink, sendEnv));
    assert.equal(run.sends(), 0);
    const last = run.queueUpdates.at(-1)!;
    assert.equal(last.status, "skipped");
    // 시험 환경에는 AI 키가 없다 → config, 키가 있고 한도를 넘으면 quota
    assert.ok(["config", "quota"].includes(String(last.stopReason)), String(last.stopReason));
});

test("UX-163: 자동 첫 메일도 매핑 누락이면 NHN 0회, 발송 이력에 사유를 남긴 failed", async (t) => {
    isolateEnv(t, { NEXT_PUBLIC_BASE_URL: "https://example.test" });
    const { db } = await import("./db");
    const { processEmailAutoTrigger } = await import("./email-automation");
    let posts = 0;
    const { calls } = installFakeDb(t, db, (c) => {
        if (c.op === "select" && c.table === "email_template_links") return [{ id: 7, partitionId: 3, emailTemplateId: 9, recipientField: "email", isActive: 1, variableMappings: { "##이름##": "name" } }];
        if (c.table === "email_configs") return [{ fromEmail: "sender@example.test", appKey: "fake", secretKey: "fake", isActive: 1 }];
        if (c.table === "email_templates") return [{ id: 9, subject: "##이름##님", htmlBody: "##회사명##", useUnsubscribe: false }];
        if (c.table === "partitions") return [{ workspaceId: 2 }];
        if (c.table === "workspaces") return [{ orgId, id: 2 }];
        return [];
    });
    t.mock.method(globalThis, "fetch", async () => { posts++; return Response.json({}); });
    await processEmailAutoTrigger({ record: { id: 1, data: { email: "lead@example.test", name: "홍길동" } } as never, orgId, partitionId: 3, triggerType: "on_create" });
    assert.equal(posts, 0);
    const log = calls.find((c) => c.op === "insert" && c.table === "email_send_logs");
    assert(log, "발송 이력에 남긴다");
    const values = log.values as { status: string; resultMessage: string };
    assert.equal(values.status, "failed");
    assert.match(values.resultMessage, /##회사명##/);
});

test("UX-155: 설정 조회 — member는 앱 키도 가려 받고, admin은 그대로 받는다", async (t) => {
    for (const [role, expected] of [["member", "app***890"], ["admin", "app-key-1234567890"]] as const) {
        await t.test(role, async (t) => {
            const { db, request, membership } = await staff(t, role);
            const { GET } = await import("../app/api/email/config/route");
            installFakeDb(t, db, chain(membership, (c) =>
                c.table === "email_configs" ? [{ id: 1, appKey: "app-key-1234567890", secretKey: "secret-abcdef", fromName: null, fromEmail: null, signature: null, signatureEnabled: 0, isActive: 1 }] : undefined));
            const res = await GET(request("https://example.test/api/email/config", "GET"));
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.data.appKey, expected);
            assert.equal(body.data.secretKey, "sec***def");
        });
    }
});

test("UX-160: 템플릿 테스트 발송 — NHN이 수신자를 거절하면 성공이 아니고 한국어, 연결 테스트 401도 한국어", async (t) => {
    const { db, request, membership } = await staff(t);
    const testSend = await import("../app/api/email/test-send/route");
    const configTest = await import("../app/api/email/config/test/route");
    installFakeDb(t, db, chain(membership, (c) => {
        if (c.table === "email_configs") return [{ fromEmail: "sender@example.test", fromName: "가상", appKey: "fake", secretKey: "fake", isActive: 1 }];
        if (c.op === "select" && c.table === "email_templates") return [{ id: 9, subject: "가상", htmlBody: "가상", orgId }];
        return undefined;
    }));
    let reply: () => Response = () => Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" }, body: { data: { requestId: "r1", results: [{ receiveMailAddr: "to@example.test", resultCode: -3001, resultMessage: "invalid receiver" }] } } });
    t.mock.method(globalThis, "fetch", async () => reply());
    const rejected = await (await testSend.POST(request("https://example.test/api/email/test-send", "POST", { templateId: 9, recipientEmail: "to@example.test" }))).json();
    assert.equal(rejected.success, false);
    assert.match(rejected.error, /^NHN이 테스트 발송 요청을 받지 않았습니다 \(코드 -3001/);

    reply = () => Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" }, body: { data: { requestId: "r2", results: [{ receiveMailAddr: "to@example.test", resultCode: 0, resultMessage: "" }] } } });
    const ok = await (await testSend.POST(request("https://example.test/api/email/test-send", "POST", { templateId: 9, recipientEmail: "to@example.test" }))).json();
    assert.equal(ok.success, true);

    reply = () => new Response("", { status: 401, statusText: "Unauthorized" });
    const unauthorized = await (await configTest.POST(request("https://example.test/api/email/config/test", "POST", { appKey: "bad", secretKey: "bad" }))).json();
    assert.equal(unauthorized.success, false);
    assert.doesNotMatch(unauthorized.error, /Unauthorized|HTTP 401/);
    assert.match(unauthorized.error, /NHN 인증에 실패/);
});
