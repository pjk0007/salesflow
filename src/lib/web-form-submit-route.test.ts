import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv } from "./auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000044";
const form = { id: 4, orgId: ORG, workspaceId: 1, partitionId: 11, slug: "demo", isActive: 1, defaultValues: [] };
const fields = [
    { id: 1, formId: 4, label: "이름", fieldType: "text", linkedFieldKey: "name", isRequired: 1, sortOrder: 0 },
    { id: 2, formId: 4, label: "개인정보 동의", fieldType: "checkbox", linkedFieldKey: "agree", isRequired: 1, sortOrder: 1 },
];

async function submit(t: import("node:test").TestContext, body: unknown, partitionRows: unknown[] = []) {
    isolateEnv(t);
    const { db } = await import("./db");
    const { POST } = await import("../app/api/public/forms/[slug]/submit/route");
    const { calls } = installFakeDb(t, db, (c) => c.table === "web_forms" ? [form]
        : c.table === "web_form_fields" ? fields
        : c.table === "partitions" ? partitionRows : []);
    const response = await POST(new NextRequest("http://localhost/api/public/forms/demo/submit", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ slug: "demo" }) });
    const writes = calls.filter((c) => c.op === "insert" || c.op === "update" || c.op === "delete");
    return { status: response.status, body: await response.json(), writes };
}

test("UX-044 편집 저장으로 질문 id가 바뀐 뒤 열린 폼의 제출은 409 안내로 막고 아무것도 쓰지 않는다", async (t) => {
    const r = await submit(t, { data: { "999": "옛 질문 답", "1": "홍길동", "2": "true" } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /새로 불러온 뒤/);
    assert.equal(r.writes.length, 0);
});

test("UX-046 필수 동의 체크박스를 해제한 'false'는 통과하지 않는다", async (t) => {
    for (const agree of ["false", "", "0"]) {
        await t.test(agree || "빈 값", async (t) => {
            const r = await submit(t, { data: { "1": "홍길동", "2": agree } });
            assert.equal(r.status, 400);
            assert.match(r.body.error, /체크해야/);
            assert.equal(r.writes.length, 0);
        });
    }
});

test("UX-042 폼이 가리키는 파티션이 폼 조직 것이 아니면 리드를 받지 않는다", async (t) => {
    const r = await submit(t, { data: { "1": "홍길동", "2": "true" } }, []);
    assert.equal(r.status, 404);
    assert.equal(r.writes.length, 0);
});

test("배열 제출은 400", async (t) => {
    const r = await submit(t, { data: ["홍길동"] });
    assert.equal(r.status, 400);
});

test("UX-029 잘린 JSON 본문은 400 JSON, 폼 조회 DB 실패는 500 JSON이며 아무것도 쓰지 않는다", async (t) => {
    isolateEnv(t);
    t.mock.method(console, "error", () => {});
    const { db } = await import("./db");
    const { POST } = await import("../app/api/public/forms/[slug]/submit/route");
    const send = (body: string) => POST(new NextRequest("http://localhost/api/public/forms/demo/submit", {
        method: "POST", headers: { "content-type": "application/json" }, body,
    }), { params: Promise.resolve({ slug: "demo" }) });

    await t.test("잘린 JSON", async (t) => {
        const { calls } = installFakeDb(t, db, () => []);
        const response = await send("{\"data\":");
        assert.equal(response.status, 400);
        assert.equal((await response.json()).success, false);
        assert.equal(calls.length, 0);
    });
    await t.test("DB 실패", async (t) => {
        const { calls } = installFakeDb(t, db, (c) => (c.table === "web_forms" ? new Error("가상 DB 장애") : []));
        const response = await send(JSON.stringify({ data: { "1": "홍길동", "2": "true" } }));
        assert.equal(response.status, 500);
        assert.equal((await response.json()).error, "서버 오류가 발생했습니다.");
        assert.equal(calls.filter((c) => c.op !== "select").length, 0);
    });
});
