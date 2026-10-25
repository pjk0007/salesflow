// UX-248 — 자동 준비 설정 조회가 실행 관리자 유효성(활성·owner/admin)을 작업기와 같은 조건으로 내려준다.
// UX-246 — '다시 준비'(refresh)는 바로 실행하고 last_error를 비워 보류 회차 뒤 7일 대기를 건너뛰게 한다.
// 실제 DB 없이 원시 SQL 연결을 가로채 문장·매개변수만 확인한다(SQL 실행 검증은 아님).
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000001";

async function setup(t: TestContext) {
    isolateEnv(t);
    const { db, queryClient } = await import("../db");
    const { generateToken } = await import("../auth");
    installFakeDb(t, db, (call) =>
        isMembershipLookup(call) ? [{ role: "admin", tokenVersion: 0, membershipId: 71 }] : [],
    );
    const sql: { text: string; values: unknown[] }[] = [];
    const connection = Object.assign(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const text = strings.join("?");
            sql.push({ text, values });
            if (text.includes("FROM ai_copy_automation_settings s"))
                return [
                    { id: 1, enabled: true, actor_valid: true },
                    { id: 2, enabled: true, actor_valid: false },
                ];
            if (text.includes("SELECT * FROM ai_copy_automation_cycles WHERE id="))
                return [{ id: 9, setting_id: 2, stage: "blocked", org_id: ORG }];
            return [];
        },
        { release() {} },
    );
    t.mock.method(queryClient, "reserve", async () => connection as never);
    const token = generateToken({
        userId: "00000000-0000-4000-8000-000000000002",
        orgId: ORG,
        email: "staff@example.test",
        name: "가상",
        role: "admin",
        tokenVersion: 0,
        membershipId: 71,
    });
    const request = (method: "GET" | "POST", body?: unknown) =>
        new NextRequest("http://localhost/api/ai/copy-automation?workspaceId=3", {
            method,
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    return { sql, request };
}

test("UX-248 설정마다 actor_valid: 작업기와 같은 활성·owner/admin 조건", async (t) => {
    const { sql, request } = await setup(t);
    const { GET } = await import("../../app/api/ai/copy-automation/route");
    const body = await (await GET(request("GET"))).json();
    assert.deepEqual(
        body.data.settings.map((s: { actor_valid: boolean }) => s.actor_valid),
        [true, false],
        "일부만 무효인 경우도 설정별로 구분",
    );
    const settings = sql.find((s) => s.text.includes("FROM ai_copy_automation_settings s"))!;
    assert.match(settings.text, /u\.is_active=1/);
    assert.match(settings.text, /m\.role IN\('owner','admin'\)/);
    assert.match(settings.text, /AS actor_valid/);
    assert.ok(settings.values.includes(ORG) && settings.values.includes(3));
});

test("UX-246 다시 준비: 바로 실행하고 last_error를 비운다(내 조직 설정만)", async (t) => {
    const { sql, request } = await setup(t);
    const { POST } = await import("../../app/api/ai/copy-automation/route");
    const res = await POST(request("POST", { action: "refresh", cycleId: 9 }));
    assert.equal(res.status, 200);
    const update = sql.find((s) => s.text.startsWith("UPDATE ai_copy_automation_settings"))!;
    assert.match(update.text, /last_error=NULL/);
    assert.ok(update.values.includes(2) && update.values.includes(ORG));
});
