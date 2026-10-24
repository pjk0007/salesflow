// UX-042·166·173·250·110·039·050 — 요청 본문의 파티션·레코드·키가 내 조직·권한 안인지 쓰기·발송·AI 전에 확인하는지.
// 실제 DB·외부 API를 쓰지 않는다: db는 가상, fetch는 가로채서 호출 횟수와 본문만 기록한다.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall, type Responder } from "./auth-fake-db.test-helper";

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";

async function load(t: TestContext) {
    isolateEnv(t, { GEMINI_API_KEY: "fake-gemini-key-for-test" });
    const auth = await import("./auth");
    const { db } = await import("./db");
    return { ...auth, db };
}

const member = (role: "owner" | "admin" | "member"): Responder => (call) =>
    isMembershipLookup(call) ? [{ role, tokenVersion: 0, isSuperAdmin: 0 }] : undefined;
/** 여러 응답기를 앞에서부터 시도한다(undefined면 다음, 끝까지 없으면 빈 결과). */
const chain = (...responders: Responder[]): Responder => (call) => {
    for (const r of responders) {
        const result = r(call);
        if (result !== undefined) return result;
    }
    return [];
};
/** requirePartitionAccess의 파티션 조회(partitions JOIN workspaces, 요청자 조직 조건). */
const isPartitionLookup = (c: FakeCall) => c.op === "select" && c.table === "partitions" && c.joins.includes("workspaces");
const ownPartition = (id: number, workspaceId = 3): Responder => (c) =>
    isPartitionLookup(c) && c.params.includes(id) && c.params.includes(ORG_A)
        ? [{ partition: { id, workspaceId, folderId: null, name: "가상 파티션" }, workspace: { id: workspaceId, orgId: ORG_A } }]
        : isPartitionLookup(c)
          ? []
          : undefined;

function bearer(token: string, url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
    return new NextRequest(url, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
    });
}

function captureFetch(t: TestContext, reply: (url: string) => Response = () => Response.json({ header: { isSuccessful: false, resultCode: -1, resultMessage: "가상 응답" } })) {
    const sent: { url: string; body: string }[] = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        sent.push({ url, body: typeof init?.body === "string" ? init.body : "" });
        return reply(url);
    });
    return sent;
}

const tokenFor = (generateToken: (p: never) => string, role: "owner" | "admin" | "member") =>
    generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role, tokenVersion: 0 } as never);

test("웹 폼 생성: 다른 조직 파티션은 404, 워크스페이스는 파티션 것을 쓴다 (UX-042)", async (t) => {
    const { generateToken, db } = await load(t);
    const { POST } = await import("../app/api/web-forms/route");
    const token = tokenFor(generateToken, "member");
    const body = { name: "폼", title: "제목", workspaceId: 999, partitionId: 11 };

    await t.test("다른 조직 partitionId", async (t) => {
        const { calls } = installFakeDb(t, db, chain(member("member"), ownPartition(12)));
        const res = await POST(bearer(token, "http://localhost/api/web-forms", { method: "POST", body }));
        assert.equal(res.status, 404);
        assert.equal(calls.filter((c) => c.op === "insert").length, 0);
    });
    await t.test("자기 조직 파티션 — 요청의 workspaceId(999) 대신 파티션의 3을 저장", async (t) => {
        const { calls } = installFakeDb(t, db, chain(member("member"), ownPartition(11, 3), (c) => (c.op === "insert" ? [{ id: 1 }] : undefined)));
        const res = await POST(bearer(token, "http://localhost/api/web-forms", { method: "POST", body }));
        assert.equal(res.status, 201);
        const insert = calls.find((c) => c.op === "insert" && c.table === "web_forms");
        assert.deepEqual({ ...(insert?.values as object) }, { ...(insert?.values as object), workspaceId: 3, partitionId: 11, orgId: ORG_A });
    });
});

test("Meta 리드 연동·광고 계정: 다른 조직 파티션·워크스페이스 지정 거부 (UX-042 같은 누락)", async (t) => {
    const { generateToken, db } = await load(t);
    const integrations = await import("../app/api/ad-lead-integrations/route");
    const accounts = await import("../app/api/ad-accounts/[id]/route");
    const token = tokenFor(generateToken, "admin");

    await t.test("연동 생성 partitionId", async (t) => {
        const { calls } = installFakeDb(t, db, chain(member("admin"), ownPartition(12), (c) => (c.table === "ad_accounts" ? [{ id: 5, platform: "meta", orgId: ORG_A }] : undefined)));
        const res = await integrations.POST(bearer(token, "http://localhost/api/ad-lead-integrations", {
            method: "POST",
            body: { adAccountId: 5, name: "연동", partitionId: 11, formId: "f1", fieldMappings: {} },
        }));
        assert.equal(res.status, 404);
        assert.equal(calls.filter((c) => c.op === "insert").length, 0);
    });
    await t.test("광고 계정 workspaceId", async (t) => {
        const { calls } = installFakeDb(t, db, chain(member("admin"), (c) => (c.table === "ad_accounts" ? [{ id: 5 }] : c.table === "workspaces" ? [] : undefined)));
        const res = await accounts.PATCH(bearer(token, "http://localhost/api/ad-accounts/5", { method: "PATCH", body: { workspaceId: 77 } }), { params: Promise.resolve({ id: "5" }) });
        assert.equal(res.status, 404);
        assert.equal(calls.filter((c) => c.op === "update").length, 0);
    });
});

test("AI 이메일 작성: 다른 조직 레코드는 404이고 AI를 부르지 않는다 (UX-166)", async (t) => {
    const { generateToken, db } = await load(t);
    const plain = await import("../app/api/ai/generate-email/route");
    const stream = await import("../app/api/ai/generate-email-stream/route");
    const token = tokenFor(generateToken, "member");
    const body = { prompt: "안내 메일", recordId: 42, model: "gemini-3.5-flash-lite" };
    const isRecordLookup = (c: FakeCall) => c.op === "select" && c.table === "records";

    for (const [label, handler, path] of [["일반", plain.POST, "generate-email"], ["스트림", stream.POST, "generate-email-stream"]] as const) {
        await t.test(`${label}: 다른 조직 recordId`, async (t) => {
            const sent = captureFetch(t);
            const { calls } = installFakeDb(t, db, chain(member("member"), (c) => (isRecordLookup(c) ? [] : undefined)));
            const res = await handler(bearer(token, `http://localhost/api/ai/${path}`, { method: "POST", body }));
            assert.equal(res.status, 404);
            assert.equal(sent.length, 0, "AI 호출 0회");
            const lookup = calls.find(isRecordLookup)!;
            assert.ok(lookup.joins.includes("workspaces") && lookup.params.includes(ORG_A), "레코드는 조직 경계로 조회한다");
        });
    }
    await t.test("자기 조직 레코드는 확인된 record의 자료만 프롬프트에 들어간다", async (t) => {
        const sent = captureFetch(t, () => Response.json({ error: { message: "가상" } }, { status: 400 }));
        installFakeDb(t, db, chain(member("member"), (c) =>
            isRecordLookup(c) ? [{ record: { id: 42, data: { name: "가상고객이름" } }, partition: { id: 11, workspaceId: 3, folderId: null } }] : undefined));
        await plain.POST(bearer(token, "http://localhost/api/ai/generate-email", { method: "POST", body }));
        assert.ok(sent.length >= 1, "AI 호출이 일어난다");
        assert.match(sent[0].body, /가상고객이름/);
    });
});

test("알림톡 수동 발송: 연결 파티션 밖·다른 조직·없는 레코드가 섞이면 외부 발송 0회 (UX-173)", async (t) => {
    const { generateToken, db } = await load(t);
    const { POST } = await import("../app/api/alimtalk/send/route");
    const token = tokenFor(generateToken, "member");
    const link = { id: 9, partitionId: 11, senderKey: "sk", templateCode: "T1", recipientField: "phone", variableMappings: null };
    const base = (records: unknown[], linkRows: unknown[] = [{ alimtalk_template_links: link }]): Responder =>
        chain(member("member"), (c) => {
            if (c.table === "alimtalk_configs") return [{ appKey: "fake-app", secretKey: "fake-secret" }];
            if (c.table === "alimtalk_template_links") return linkRows;
            if (c.table === "records") return records;
            return undefined;
        }, ownPartition(11));
    const send = (recordIds: unknown[]) => POST(bearer(token, "http://localhost/api/alimtalk/send", { method: "POST", body: { templateLinkId: 9, recordIds } }));
    const r = (id: number, phone: string) => ({ id, partitionId: 11, data: { phone } });

    await t.test("다른 파티션(또는 다른 조직) 레코드 섞임", async (t) => {
        const sent = captureFetch(t);
        const { calls } = installFakeDb(t, db, base([r(1, "01011112222")]));
        const res = await send([1, 2]);
        assert.equal(res.status, 404);
        assert.equal(sent.length, 0);
        const recordQuery = calls.find((c) => c.table === "records")!;
        assert.match(recordQuery.sql, /"records"\."partition_id" = \$\d+/);
        assert.ok(recordQuery.params.includes(11), "연결 파티션으로 제한한다");
    });
    await t.test("존재하지 않는 id", async (t) => {
        const sent = captureFetch(t);
        installFakeDb(t, db, base([]));
        assert.equal((await send([404])).status, 404);
        assert.equal(sent.length, 0);
    });
    await t.test("다른 조직의 템플릿 연결", async (t) => {
        const sent = captureFetch(t);
        installFakeDb(t, db, base([r(1, "01011112222")], []));
        assert.equal((await send([1])).status, 404);
        assert.equal(sent.length, 0);
    });
    await t.test("잘못된 id 형식", async (t) => {
        const sent = captureFetch(t);
        installFakeDb(t, db, base([]));
        assert.equal((await send(["x"])).status, 400);
        assert.equal(sent.length, 0);
    });
    await t.test("같은 파티션 레코드만이면 발송 요청이 나간다", async (t) => {
        const sent = captureFetch(t);
        installFakeDb(t, db, base([r(1, "01011112222"), r(2, "01033334444")]));
        await send([1, 2]);
        const message = sent.find((s) => s.url.endsWith("/messages"));
        assert.ok(message, "NHN 발송 호출");
        assert.match(message!.body, /01011112222/);
        assert.match(message!.body, /01033334444/);
    });
});

test("알림톡 설정 변경 3경로는 관리자만, 조회·발송은 member도 유지 (UX-250)", async (t) => {
    const { generateToken, db } = await load(t);
    const config = await import("../app/api/alimtalk/config/route");
    const defaultSender = await import("../app/api/alimtalk/config/default-sender/route");
    const senderDelete = await import("../app/api/alimtalk/senders/[senderKey]/route");
    const memberToken = tokenFor(generateToken, "member");
    const adminToken = tokenFor(generateToken, "admin");
    const writes = (calls: FakeCall[]) => calls.filter((c) => c.op !== "select");

    await t.test("member: 앱 키 저장·기본 발신프로필·삭제 모두 403 한국어, 쓰기·외부 호출 없음", async (t) => {
        const sent = captureFetch(t);
        const { calls } = installFakeDb(t, db, chain(member("member"), (c) => (c.table === "alimtalk_configs" ? [{ id: 1, appKey: "a", secretKey: "s" }] : undefined)));
        const responses = [
            await config.POST(bearer(memberToken, "http://localhost/api/alimtalk/config", { method: "POST", body: { appKey: "new", secretKey: "new" } })),
            await defaultSender.PUT(bearer(memberToken, "http://localhost/api/alimtalk/config/default-sender", { method: "PUT", body: { senderKey: "sk" } })),
            await senderDelete.DELETE(bearer(memberToken, "http://localhost/api/alimtalk/senders/sk", { method: "DELETE" }), { params: Promise.resolve({ senderKey: "sk" }) }),
        ];
        for (const res of responses) {
            assert.equal(res.status, 403);
            assert.equal((await res.json()).error, "관리자만 변경할 수 있습니다.");
        }
        assert.equal(writes(calls).length, 0);
        assert.equal(sent.length, 0);
    });
    await t.test("member도 설정 조회는 가능", async (t) => {
        installFakeDb(t, db, chain(member("member"), (c) => (c.table === "alimtalk_configs" ? [{ id: 1, appKey: "a", secretKey: "secretvalue", defaultSenderKey: null, isActive: 1 }] : undefined)));
        const res = await config.GET(bearer(memberToken, "http://localhost/api/alimtalk/config"));
        assert.equal(res.status, 200);
    });
    await t.test("admin: 앱 키 저장 가능", async (t) => {
        const { calls } = installFakeDb(t, db, chain(member("admin"), (c) => (c.op === "insert" ? [{ id: 3 }] : undefined)));
        const res = await config.POST(bearer(adminToken, "http://localhost/api/alimtalk/config", { method: "POST", body: { appKey: "new", secretKey: "new" } }));
        assert.equal(res.status, 201);
        assert.equal(calls.filter((c) => c.op === "insert" && c.table === "alimtalk_configs").length, 1);
    });
    await t.test("admin: 이 조직 앱 키에 없는 발신프로필은 기본값으로 저장하지 않는다", async (t) => {
        captureFetch(t, () => Response.json({ header: { isSuccessful: false, resultCode: -1, resultMessage: "없음" } }));
        const { calls } = installFakeDb(t, db, chain(member("admin"), (c) => (c.table === "alimtalk_configs" ? [{ id: 1, appKey: "a", secretKey: "s" }] : undefined)));
        const res = await defaultSender.PUT(bearer(adminToken, "http://localhost/api/alimtalk/config/default-sender", { method: "PUT", body: { senderKey: "other-org-key" } }));
        assert.equal(res.status, 400);
        assert.equal(calls.filter((c) => c.op === "update").length, 0);
    });
    await t.test("admin: 등록된 발신프로필은 기본값으로 저장", async (t) => {
        captureFetch(t, () => Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "" }, senderKey: "sk" }));
        const { calls } = installFakeDb(t, db, chain(member("admin"), (c) => (c.table === "alimtalk_configs" ? [{ id: 1, appKey: "a", secretKey: "s" }] : undefined)));
        const res = await defaultSender.PUT(bearer(adminToken, "http://localhost/api/alimtalk/config/default-sender", { method: "PUT", body: { senderKey: "sk" } }));
        assert.equal(res.status, 200);
        assert.equal(calls.filter((c) => c.op === "update" && c.table === "alimtalk_configs").length, 1);
    });
});

test("실시간 구독: 다른 조직 파티션은 404, 권한 있는 파티션만 스트림을 연다 (UX-110)", async (t) => {
    const { generateToken, db } = await load(t);
    const { GET } = await import("../app/api/sse/route");
    const token = tokenFor(generateToken, "member");

    await t.test("다른 조직 파티션", async (t) => {
        installFakeDb(t, db, chain(member("member"), ownPartition(11)));
        const res = await GET(bearer(token, "http://localhost/api/sse?partitionId=12"));
        assert.equal(res.status, 404);
    });
    await t.test("숫자가 아닌 partitionId", async (t) => {
        installFakeDb(t, db, chain(member("member"), ownPartition(11)));
        assert.equal((await GET(bearer(token, "http://localhost/api/sse?partitionId=abc"))).status, 400);
    });
    await t.test("자기 조직 파티션 — 구독 성공", async (t) => {
        installFakeDb(t, db, chain(member("member"), ownPartition(11)));
        const abort = new AbortController();
        const res = await GET(bearer(token, "http://localhost/api/sse?partitionId=011", { signal: abort.signal }));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/event-stream");
        const reader = res.body!.getReader();
        const first = new TextDecoder().decode((await reader.read()).value);
        assert.match(first, /event: connected/);
        abort.abort();
        await reader.cancel().catch(() => undefined);
    });
});

test("범위 제한 토큰: MCP 목록·로그 도구가 접근 가능한 파티션으로 좁혀진다 (UX-039)", async (t) => {
    const { tokenAccessiblePartitions, tokenScopeCovers, db } = await load(t);
    const { createMcpToolHandlers } = await import("./mcp/tools");
    const READ = { read: true, create: false, update: false, delete: false };
    const rows = [
        { id: 101, folderId: 10, workspaceId: 1 },
        { id: 102, folderId: null, workspaceId: 1 },
        { id: 103, folderId: 20, workspaceId: 2 },
    ];
    const scoped = (scopeType: string, scopeId: number) => ({ id: 1, orgId: ORG_A, scopes: [{ id: 1, tokenId: 1, scopeType, scopeId, permissions: READ }] }) as never;

    await t.test("tokenScopeCovers — 폴더·워크스페이스·파티션", () => {
        const s = (scopeType: string, scopeId: number) => [{ scopeType, scopeId, permissions: READ }];
        assert.equal(tokenScopeCovers(s("folder", 10), rows[0], "read"), true);
        assert.equal(tokenScopeCovers(s("folder", 10), rows[1], "read"), false);
        assert.equal(tokenScopeCovers(s("workspace", 2), rows[2], "read"), true);
        assert.equal(tokenScopeCovers(s("partition", 102), rows[1], "create"), false);
    });
    await t.test("org 범위는 제한 없음(null), 파티션 범위는 해당 id만", async (t) => {
        installFakeDb(t, db, (c) => (c.table === "partitions" ? rows : []));
        assert.equal(await tokenAccessiblePartitions(scoped("org", 0)), null);
        assert.deepEqual(await tokenAccessiblePartitions(scoped("partition", 102)), { partitionIds: [102], workspaceIds: [1] });
        assert.deepEqual(await tokenAccessiblePartitions(scoped("workspace", 2)), { partitionIds: [103], workspaceIds: [2] });
    });
    await t.test("list_partitions·list_email_logs에 IN 조건, 접근 가능한 것이 없으면 로그를 읽지 않는다", async (t) => {
        const { calls } = installFakeDb(t, db, (c) => (c.table === "partitions" && c.joins.length === 1 ? rows : []));
        const tools = createMcpToolHandlers();
        await tools.list_partitions({}, scoped("folder", 10));
        const listQuery = calls.filter((c) => c.table === "partitions").at(-1)!;
        assert.match(listQuery.sql, /"partitions"\."id" in \(\$\d+\)/);
        assert.ok(listQuery.params.includes(101));

        const before = calls.length;
        const logs = await tools.list_email_logs({}, scoped("partition", 999));
        assert.deepEqual(JSON.parse(logs.content[0].text).logs, []);
        assert.equal(calls.slice(before).filter((c) => c.table === "email_send_logs").length, 0);
    });
});

test("Meta 연동: 페이지 토큰 미노출·관리자 전용, OAuth state 봉인 (UX-050)", async (t) => {
    const { sealOAuthState, openOAuthState, generateToken, db } = await load(t);
    const pages = await import("../app/api/meta/pages/route");
    const callback = await import("../app/api/meta/callback/route");

    await t.test("봉인한 state는 열리고, 변조·다른 용도·만료는 거부", (t) => {
        const state = sealOAuthState("meta", { orgId: ORG_A, platformId: 5 });
        assert.equal(openOAuthState<{ platformId: number }>("meta", state)?.platformId, 5);
        assert.equal(openOAuthState("google", state), null);
        assert.equal(openOAuthState("meta", state.slice(0, -2) + "AA"), null);
        assert.equal(openOAuthState("meta", Buffer.from(JSON.stringify({ orgId: ORG_A, platformId: 5 })).toString("base64")), null);
        const issued = Date.now();
        t.mock.method(Date, "now", () => issued + 16 * 60 * 1000);
        assert.equal(openOAuthState("meta", state), null);
    });
    await t.test("서명 없는 예전 형식 state로는 토큰을 덮어쓰지 않는다", async (t) => {
        const { calls } = installFakeDb(t, db, () => [{ id: 5, credentials: { appId: "a", appSecret: "b" } }]);
        const forged = Buffer.from(JSON.stringify({ orgId: ORG_A, platformId: 5 })).toString("base64");
        const res = await callback.GET(new NextRequest(`http://localhost/api/meta/callback?code=c&state=${encodeURIComponent(forged)}`));
        assert.match(await res.text(), /만료되었거나 올바르지 않습니다/);
        assert.equal(calls.length, 0);
    });
    await t.test("봉인 state의 조직 조건으로 플랫폼을 찾는다", async (t) => {
        captureFetch(t, () => Response.json({ error: { message: "가상" } }));
        const { calls } = installFakeDb(t, db, () => []);
        const state = sealOAuthState("meta", { orgId: ORG_A, platformId: 5 });
        await callback.GET(new NextRequest(`http://localhost/api/meta/callback?code=c&state=${encodeURIComponent(state)}`));
        const lookup = calls.find((c) => c.table === "ad_platforms")!;
        assert.ok(lookup.params.includes(ORG_A) && lookup.params.includes(5));
    });
    await t.test("member는 페이지 목록 403", async (t) => {
        const sent = captureFetch(t);
        installFakeDb(t, db, member("member"));
        const res = await pages.GET(bearer(tokenFor(generateToken, "member"), "http://localhost/api/meta/pages?platformId=5"));
        assert.equal(res.status, 403);
        assert.equal(sent.length, 0);
    });
    await t.test("admin 응답에는 페이지 액세스 토큰이 없다(서버 저장은 유지)", async (t) => {
        captureFetch(t, () => Response.json({ data: [{ id: "p1", name: "페이지", access_token: "PAGE-SECRET" }] }));
        const { calls } = installFakeDb(t, db, chain(member("admin"), (c) => (c.table === "ad_platforms" && c.op === "select" ? [{ id: 5, credentials: { accessToken: "user-token" } }] : undefined)));
        const res = await pages.GET(bearer(tokenFor(generateToken, "admin"), "http://localhost/api/meta/pages?platformId=5"));
        const text = await res.text();
        assert.equal(res.status, 200);
        assert.doesNotMatch(text, /PAGE-SECRET/);
        assert.deepEqual(JSON.parse(text).data, [{ id: "p1", name: "페이지" }]);
        const saved = calls.find((c) => c.op === "update" && c.table === "ad_platforms");
        assert.equal((saved?.set as { credentials: { pageAccessTokens: Record<string, string> } }).credentials.pageAccessTokens.p1, "PAGE-SECRET");
    });
});
