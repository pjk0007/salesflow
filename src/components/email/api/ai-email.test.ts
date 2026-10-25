import test from "node:test";
import assert from "node:assert/strict";
import { readAiEmailStream } from "./ai-email";

const mail = { subject: "가상 제목", htmlBody: "<p>한글 {본문}</p>" };
const event = (kind: string, value: unknown) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
const chunks = event("chunk", { text: JSON.stringify(mail) });
const done = event("done", { usage: { promptTokens: 1, completionTokens: 2 } });

test("SSE 이벤트와 한국어 UTF-8이 한 바이트씩 나뉘어도 완료 결과를 읽는다", async () => {
    const bytes = new TextEncoder().encode((chunks + done).replace(/\n/g, "\r\n"));
    const response = new Response(new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
    } }));
    const seen: string[] = [];
    const result = await readAiEmailStream(response, new AbortController().signal, text => seen.push(text));
    assert.deepEqual(result, { success: true, data: mail });
    assert.deepEqual(seen, [JSON.stringify(mail)]);
});

test("유효한 초안 JSON이 와도 done 전에 연결이 끊기면 실패다", async () => {
    const result = await readAiEmailStream(new Response(chunks), new AbortController().signal, () => {});
    assert.equal(result.success, false);
    assert.match(result.error!, /완료되기 전에/);
});

test("오류 이벤트·잘못된 프레임·잘못된 이메일 필드는 성공으로 적용하지 않는다", async () => {
    for (const body of [chunks + event("error", { error: "한도를 확인해주세요." }), "event: chunk\ndata: broken\n\n", event("chunk", { text: '{"subject":[],"htmlBody":1}' }) + done]) {
        assert.equal((await readAiEmailStream(new Response(body), new AbortController().signal, () => {})).success, false);
    }
});

test("조회 대기 중 취소하면 reader를 닫고 늦은 청크를 적용하지 않는다", async () => {
    const abort = new AbortController();
    let cancelled = 0, applied = 0;
    const response = new Response(new ReadableStream({ cancel() { cancelled++; } }));
    const pending = readAiEmailStream(response, abort.signal, () => { applied++; });
    abort.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(cancelled, 1);
    assert.equal(applied, 0);
});

test("초안 콜백에서 취소된 같은 패킷의 done도 성공으로 반환하지 않는다", async () => {
    const abort = new AbortController();
    await assert.rejects(readAiEmailStream(new Response(chunks + done), abort.signal, () => abort.abort()), { name: "AbortError" });
});

test("HTML 게이트웨이·영문 공급자 오류는 한국어로, 서버 한국어는 그대로 표시한다", async () => {
    for (const response of [new Response("<h1>502</h1>", { status: 502 }), Response.json({ error: "secret provider failure" }, { status: 500 })]) {
        assert.equal((await readAiEmailStream(response, new AbortController().signal, () => {})).error, "AI 이메일 생성에 실패했습니다.");
    }
    assert.equal((await readAiEmailStream(Response.json({ error: "사용량을 초과했습니다." }, { status: 429 }), new AbortController().signal, () => {})).error, "사용량을 초과했습니다.");
});
