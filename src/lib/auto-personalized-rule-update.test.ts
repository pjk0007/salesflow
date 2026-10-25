// UX-140·165 — AI 개인화 규칙 수정(PUT): 빈 문자열은 지움, 진행 중 문구 실험이 무효화되는 변경은 확인 전 저장하지 않음.
// 실제 DB·외부 호출을 쓰지 않는다(가상 db).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";

const orgId = "00000000-0000-4000-8000-0000000000c1";
const userId = "00000000-0000-4000-8000-0000000000c2";
const rule = {
    id: 7, orgId, partitionId: 3, name: "기존 규칙", prompt: "기존 지시사항", tone: "friendly", model: null,
    recipientField: "email", companyField: "company", productId: null, ctaUrl: null, format: "plain",
    signatureId: null, useSignaturePersona: 0, senderProfileId: null, senderProfileIds: null, followupConfig: null,
    useUnsubscribe: 0, preventDuplicate: 0, triggerCondition: null, triggerType: "on_create", autoResearch: 1,
    isActive: 1, isDraft: 0, assetIds: null,
};

async function put(t: TestContext, body: Record<string, unknown>, experiments: unknown[]) {
    isolateEnv(t);
    const { db } = await import("./db"), { generateToken } = await import("./auth");
    const { PUT } = await import("../app/api/email/auto-personalized/[id]/route");
    const token = generateToken({ userId, orgId, name: "가상", email: "staff@example.test", role: "admin", membershipId: 71, tokenVersion: 0 } as never);
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.op === "select" && c.table === "email_auto_personalized_links") return [rule];
        if (c.op === "select" && c.table === "email_copy_experiments") return experiments;
        if (c.op === "update") return [{ id: 7 }];
        return [];
    });
    const response = await PUT(new NextRequest("https://example.test/api/email/auto-personalized/7", {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: "7" }) });
    return { response, calls, json: await response.json() };
}

const running = [{ id: 31, name: "첫 메일 A/B", state: "running" }];

test("UX-140: 수정에서 빈 이름·지시사항·톤은 null로 지운다", async (t) => {
    const { response, calls } = await put(t, { name: "", prompt: "", tone: "" }, []);
    assert.equal(response.status, 200);
    const set = calls.find((c) => c.op === "update")!.set as Record<string, unknown>;
    assert.equal(set.name, null);
    assert.equal(set.prompt, null);
    assert.equal(set.tone, null);
});

test("UX-165: 진행 중 실험의 비교 조건이 바뀌면 확인 전에는 저장하지 않는다", async (t) => {
    await t.test("지시사항 변경 + 실행 중 실험 → 409, 쓰기 0회, 실험 목록 반환", async (t) => {
        const { response, calls, json } = await put(t, { prompt: "새 지시사항" }, running);
        assert.equal(response.status, 409);
        assert.equal(json.code, "experiment_impact");
        assert.deepEqual(json.experiments, running);
        assert.equal(calls.filter((c) => c.op === "update").length, 0);
        const lookup = calls.find((c) => c.table === "email_copy_experiments")!;
        assert.ok(lookup.params.includes(orgId) && lookup.params.includes(7), "조직·규칙 조건으로 조회");
        assert.ok(lookup.params.includes("running") && lookup.params.includes("paused"), "진행 중 상태만");
    });
    await t.test("확인 후 다시 저장하면 반영", async (t) => {
        const { response, calls } = await put(t, { prompt: "새 지시사항", confirmExperimentImpact: true }, running);
        assert.equal(response.status, 200);
        assert.equal((calls.find((c) => c.op === "update")!.set as { prompt: string }).prompt, "새 지시사항");
        assert.equal(calls.filter((c) => c.table === "email_copy_experiments").length, 0);
    });
    await t.test("비교 항목이 아닌 규칙명만 바꾸면 실험을 조회하지 않고 저장", async (t) => {
        const { response, calls } = await put(t, { name: "새 이름" }, running);
        assert.equal(response.status, 200);
        assert.equal(calls.filter((c) => c.table === "email_copy_experiments").length, 0);
    });
    await t.test("같은 값을 다시 보내는 저장(무변경)은 경고 없음", async (t) => {
        const { response } = await put(t, { prompt: "기존 지시사항", tone: "friendly", model: null, isDraft: 0 }, running);
        assert.equal(response.status, 200);
    });
    await t.test("진행 중 실험이 없으면 변경도 그대로 저장", async (t) => {
        const { response } = await put(t, { prompt: "새 지시사항" }, []);
        assert.equal(response.status, 200);
    });
});
