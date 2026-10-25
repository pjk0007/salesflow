import test from "node:test";
import assert from "node:assert/strict";
import { SendbClient, SendbApiError, createMemberIdentityHandler } from "../../sdk/server";

const client = (fetchImpl: typeof fetch, extra: { timeoutMs?: number; uploadTimeoutMs?: number } = {}) =>
    new SendbClient({ apiBase: "https://sendb.example.test", apiToken: "fake-token", fetchImpl, ...extra });
const html = () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } });

test("UX-122 업로드·다운로드의 게이트웨이 HTML 오류는 한국어 SendbApiError(상태 유지)", async () => {
    const c = client((async () => html()) as typeof fetch);
    for (const run of [
        () => c.uploadAttachment("conv", new Blob(["a"]), "a.txt", "00000000-0000-4000-8000-000000000001"),
        () => c.downloadAttachment("file1"),
        () => c.request("/api/v1/x"),
    ]) {
        await assert.rejects(run(), (e: unknown) => {
            assert.ok(e instanceof SendbApiError);
            assert.equal(e.status, 502);
            assert.match(e.message, /응답을 확인할 수 없습니다/);
            return true;
        });
    }
});

test("UX-122 연결 실패는 status 0, 제한 시간 초과는 408 한국어 오류", async () => {
    const offline = client((async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    await assert.rejects(offline.request("/api/v1/x"), (e: SendbApiError) => e.status === 0 && /연결하지 못했습니다/.test(e.message));
    const slow = client(((_url: string, init?: RequestInit) => new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch, { timeoutMs: 20, uploadTimeoutMs: 20 });
    await assert.rejects(slow.request("/api/v1/x"), (e: SendbApiError) => e.status === 408 && /늦어/.test(e.message));
    await assert.rejects(slow.downloadAttachment("f"), (e: SendbApiError) => e.status === 408);
});

test("UX-122 정상 업로드·다운로드 반환 형태 유지", async () => {
    const c = client((async (url: string) =>
        String(url).includes("/attachments/f1")
            ? new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "image/png" } })
            : Response.json({ success: true, data: { id: "a1", fileName: "a.txt", contentType: "text/plain", size: 1 } })) as typeof fetch);
    assert.deepEqual(await c.uploadAttachment("conv", new Blob(["a"]), "a.txt", "00000000-0000-4000-8000-000000000001"), { id: "a1", fileName: "a.txt", contentType: "text/plain", size: 1 });
    const file = await c.downloadAttachment("f1");
    assert.equal(file.bytes.byteLength, 2);
    assert.equal(file.contentType, "image/png");
});

test("UX-122 회원 연결 핸들러는 샌드비 호출 실패도 JSON으로 돌려준다", async () => {
    const c = client((async () => html()) as typeof fetch);
    const handler = createMemberIdentityHandler({
        client: c, workspaceId: 1, channelId: 1,
        authenticate: async () => ({ id: "m1", name: "가상 회원" }) as never,
    });
    const response = await handler(new Request("https://site.example.test/api/sendb", { method: "POST" }));
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.match(body.error, /응답을 확인할 수 없습니다/);
});
