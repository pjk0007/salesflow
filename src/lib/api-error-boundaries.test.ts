import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { S3Client } from "@aws-sdk/client-s3";
import { installFakeDb, isolateEnv, isMembershipLookup, type Responder } from "./auth-fake-db.test-helper";

const identity = {
    userId: "00000000-0000-4000-8000-000000000001",
    orgId: "00000000-0000-4000-8000-0000000000aa",
    email: "person@example.test", name: "가상", role: "owner" as const,
    tokenVersion: 0, membershipId: 71,
};

async function fixture(t: TestContext, options: { role?: string; superAdmin?: boolean; authFailure?: boolean; respond?: Responder } = {}) {
    isolateEnv(t, {
        R2_ENDPOINT: "https://storage.example.test", R2_ACCESS_KEY_ID: "fake-access",
        R2_SECRET_ACCESS_KEY: "fake-secret", R2_BUCKET_NAME: "fake-bucket", R2_PUBLIC_URL: "https://files.example.test",
    });
    t.mock.method(console, "error", () => {});
    t.mock.method(globalThis, "fetch", async () => { throw new Error("외부 요청은 허용되지 않는 가상 시험입니다."); });
    const { db } = await import("./db");
    const { generateToken } = await import("./auth");
    const { calls } = installFakeDb(t, db, call => isMembershipLookup(call)
        ? options.authFailure ? new Error("synthetic membership failure") : [{ role: options.role ?? "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: options.superAdmin ? 1 : 0 }]
        : options.respond?.(call) ?? []);
    const routes = {
        switchOrg: (await import("../app/api/org/switch/route")).POST,
        accept: (await import("../app/api/org/invite-accept/route")).POST,
        workspace: (await import("../app/api/workspaces/route")).POST,
        workspaceList: (await import("../app/api/workspaces/route")).GET,
        upload: (await import("../app/api/upload/route")).POST,
        meta: (await import("../app/api/webhooks/meta/route")).POST,
        metaVerify: (await import("../app/api/webhooks/meta/route")).GET,
        admin: (await import("../app/api/admin/organizations/[id]/route")).GET,
    };
    const token = generateToken(identity);
    const request = (body: BodyInit | undefined, contentType = "application/json", authenticated = true) => new NextRequest("https://example.test/api/test", {
        method: body === undefined ? "GET" : "POST", headers: { ...(authenticated ? { authorization: `Bearer ${token}` } : {}), ...(contentType ? { "content-type": contentType } : {}) }, body,
    });
    return { routes, request, calls };
}

async function expectError(response: Response, status: number) {
    assert.equal(response.status, status);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.match(body.error, /[가-힣]/);
    assert.doesNotMatch(body.error, /synthetic|SyntaxError|TypeError|SQL/);
    return body;
}

test("잘린 JSON·null·배열·문자열 본문은 JSON400이며 업무 DB에 도달하지 않는다", async t => {
    const { routes, request, calls } = await fixture(t);
    for (const name of ["switchOrg", "accept", "workspace", "meta"] as const) {
        for (const body of ["{", "null", "[]", '"text"']) {
            await expectError(await routes[name](request(body)), 400);
        }
    }
    assert.equal(calls.filter(call => !isMembershipLookup(call)).length, 0);
    for (const body of [{ name: 123 }, { name: "가상", description: [] }, { name: "가상", icon: {} }]) {
        await expectError(await routes.workspace(request(JSON.stringify(body))), 400);
    }
});

test("직원 인증·멤버 권한의 기존 401/403과 관리자 404는 유지한다", async t => {
    const { routes, request } = await fixture(t, { role: "member" });
    for (const name of ["switchOrg", "accept", "workspace", "upload"] as const) {
        await expectError(await routes[name](request("{", "application/json", false)), 401);
    }
    await expectError(await routes.workspace(request(JSON.stringify({ name: "가상" }))), 403);
    await expectError(await routes.workspaceList(request(undefined, "", false)), 401);
    await expectError(await routes.admin(request(undefined), { params: Promise.resolve({ id: identity.orgId }) }), 404);
});

test("인증 DB 실패도 HTML500 대신 한국어 JSON500으로 응답한다", async t => {
    const { routes, request } = await fixture(t, { authFailure: true });
    for (const name of ["switchOrg", "accept", "workspace", "upload"] as const) {
        await expectError(await routes[name](request("{}")), 500);
    }
    await expectError(await routes.admin(request(undefined), { params: Promise.resolve({ id: identity.orgId }) }), 500);
    await expectError(await routes.workspaceList(request(undefined)), 500);
});

test("Meta 검증 DB 실패는 JSON500, 정상 검증은 기존 평문 challenge를 보존한다", async t => {
    for (const fail of [true, false]) {
        await t.test(String(fail), async t => {
            const { routes } = await fixture(t, { respond: () => fail ? new Error("synthetic verification query failure") : [{ credentials: { webhookVerifyToken: "fake-token" } }] });
            const response = await routes.metaVerify(new NextRequest("https://example.test/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=fake-token&hub.challenge=fake-challenge"));
            if (fail) await expectError(response, 500);
            else {
                assert.equal(response.status, 200);
                assert.equal(await response.text(), "fake-challenge");
            }
        });
    }
});

test("잘못된 multipart·문자열 file·지원하지 않는 형식·크기 초과는 저장소 호출 없이400", async t => {
    const { routes, request } = await fixture(t);
    let sends = 0;
    t.mock.method(S3Client.prototype, "send", async () => { sends++; throw new Error("unexpected storage call"); });
    await expectError(await routes.upload(request("invalid", "multipart/form-data")), 400);
    for (const file of [null, "text", new File(["text"], "file.txt", { type: "text/plain" }), new File([new Uint8Array(5 * 1024 * 1024 + 1)], "file.png", { type: "image/png" })]) {
        const body = new FormData();
        if (file !== null) body.set("file", file);
        await expectError(await routes.upload(request(body, "")), 400);
    }
    assert.equal(sends, 0);
});

test("가상 저장소 실패는 업로드 전용 안내, 성공은 기존 URL 응답을 유지한다", async t => {
    const { routes, request } = await fixture(t);
    let fail = true;
    let sends = 0;
    t.mock.method(S3Client.prototype, "send", async () => {
        sends++;
        if (fail) throw new Error("synthetic storage failure");
        return {};
    });
    const body = () => { const form = new FormData(); form.set("file", new File(["fake-image"], "file.png", { type: "image/png" })); return form; };
    assert.equal((await expectError(await routes.upload(request(body(), "")), 500)).error, "이미지 업로드에 실패했습니다.");
    fail = false;
    const response = await routes.upload(request(body(), ""));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.data.fileName, "file.png");
    assert.match(result.data.url, /^https:\/\/files\.example\.test\/alimtalk\/[0-9a-f]+\.png$/);
    assert.equal(sends, 2);
});

test("관리자 조회 DB 오류는JSON500, 정상·없는 조직·빈 Meta 이벤트 계약은 유지한다", async t => {
    for (const scenario of ["failure", "missing", "normal"] as const) {
        await t.test(scenario, async t => {
            const { routes, request } = await fixture(t, { superAdmin: true, respond: call => {
                if (scenario === "failure") return new Error("synthetic admin query failure");
                if (scenario === "normal" && call.table === "organizations") return [{ id: identity.orgId, name: "가상 조직" }];
                return [];
            } });
            const response = await routes.admin(request(undefined), { params: Promise.resolve({ id: identity.orgId }) });
            if (scenario !== "normal") await expectError(response, scenario === "failure" ? 500 : 404);
            else {
                assert.equal(response.status, 200);
                assert.equal((await response.json()).data.organization.name, "가상 조직");
            }
            const webhook = await routes.meta(request(JSON.stringify({ object: "page", entry: [] }), "application/json", false));
            assert.equal(webhook.status, 200);
            assert.deepEqual(await webhook.json(), { success: true });
        });
    }
});
