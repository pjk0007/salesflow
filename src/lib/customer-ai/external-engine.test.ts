import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
    callExternalEngine,
    engineSubject,
    externalEngineFor,
    signEngineRequest,
} from "./external-engine";

const env = {
    CUSTOMER_AI_ENGINE_URL: "https://engine.example/",
    CUSTOMER_AI_ENGINE_SECRET: "s".repeat(40),
    CUSTOMER_AI_ENGINE_WORKSPACES: "7, 9",
};
const engine = { url: "https://engine.example", secret: "s".repeat(40) };
const request = {
    conversationId: "c-1",
    subjectId: "firebase-uid",
    message: "요금이 궁금해요",
    history: [],
};
const reply = (body: unknown, status = 200) =>
    (async () =>
        new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("지정한 사업만 외부 엔진을 쓴다", () => {
    assert.deepEqual(externalEngineFor(7, env), engine);
    assert.equal(externalEngineFor(8, env), null);
    assert.equal(
        externalEngineFor(7, { ...env, CUSTOMER_AI_ENGINE_SECRET: "" }),
        null,
    );
    assert.equal(
        externalEngineFor(0, { ...env, CUSTOMER_AI_ENGINE_WORKSPACES: "" }),
        null,
        "빈 목록의 Number('') = 0 이 사업 0 으로 잡히면 안 된다",
    );
});

test("서명은 원본 본문과 시각으로 만든다", async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | undefined;
    const now = new Date("2026-11-09T00:00:00Z");
    await callExternalEngine(engine, request, {
        now: () => now,
        fetch: (async (url: string, init: RequestInit) => {
            seen = { url, headers: init.headers as Record<string, string>, body: init.body as string };
            return new Response(JSON.stringify({ decision: "answer", text: "안내", handoff: null }));
        }) as unknown as typeof fetch,
    });
    const ts = String(now.getTime() / 1000);
    assert.equal(seen?.url, "https://engine.example/v1/engine/reply");
    assert.equal(seen?.headers["x-chatbot-platform"], "sendb");
    assert.equal(seen?.headers["x-chatbot-timestamp"], ts);
    const expected = "v1=" + createHmac("sha256", engine.secret).update(`${ts}.${seen?.body}`).digest("hex");
    assert.equal(seen?.headers["x-chatbot-signature"], expected);
    assert.equal(signEngineRequest(engine.secret, ts, seen!.body), expected);
});

test("답변과 이관을 sendb 처리 결과로 바꾼다", async () => {
    assert.deepEqual(
        await callExternalEngine(engine, request, {
            fetch: reply({ decision: "answer", text: "안내", handoff: null, sources: ["kb-1"] }),
        }),
        { answer: "안내", citations: [] },
    );
    assert.deepEqual(
        await callExternalEngine(engine, request, {
            fetch: reply({
                decision: "handoff",
                text: "연결해 드릴게요",
                handoff: { reason: "policy_gap", summary: "확인 필요" },
            }),
        }),
        { reason: "확인 필요" },
    );
});

test("엔진 오류와 빈 답변은 답변으로 보내지 않는다", async () => {
    await assert.rejects(callExternalEngine(engine, request, { fetch: reply({}, 401) }));
    await assert.rejects(callExternalEngine(engine, request, { fetch: reply({ decision: "answer" }) }));
    await assert.rejects(
        callExternalEngine(engine, request, {
            fetch: reply({ decision: "answer", text: "  ", handoff: null }),
        }),
    );
});

test("회원 연결이 있는 대화만 회원 ID 를 보낸다", () => {
    assert.deepEqual(engineSubject("c-1", "firebase-uid"), { subjectId: "firebase-uid" });
    assert.deepEqual(engineSubject("c-1", null), { visitorId: "c-1" });
    assert.deepEqual(engineSubject("c-1", undefined), { visitorId: "c-1" });
});
