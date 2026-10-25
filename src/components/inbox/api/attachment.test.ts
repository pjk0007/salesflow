import test from "node:test";
import assert from "node:assert/strict";
import { loadInboxAttachment } from "./attachment";
import { RequestError } from "@/lib/swr-fetcher";
import { configureMessengerApiOrigin } from "@/components/customer-messenger/api-origin";

test("UX-108 첨부 Blob과 위젯 출처 격리를 유지한다", async (t) => {
    configureMessengerApiOrigin("https://widget.example.test");
    t.after(() => configureMessengerApiOrigin());
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
        assert.match(String(url), /^https:\/\/widget.example.test/);
        assert.equal(init?.credentials, "omit");
        assert.equal(init?.redirect, "error");
        return new Response("가상 파일", { headers: { "content-type": "text/plain" } });
    });
    assert.equal(await (await loadInboxAttachment(`/api/messenger/${"a".repeat(48)}/attachments/file`)).text(), "가상 파일");
});
test("HTML 502·권한 오류·오프라인은 한국어와 상태를 보존한다", async (t) => {
    for (const status of [502, 401, 403, 404, 0]) await t.test(String(status), async (t) => {
        t.mock.method(globalThis, "fetch", async () => {
            if (!status) throw new TypeError("Failed to fetch");
            return new Response("<html>gateway error</html>", { status });
        });
        await assert.rejects(loadInboxAttachment("/api/inbox/file"), error => error instanceof RequestError && error.status === status && /[가-힣]/.test(error.message) && !/SyntaxError|Failed to fetch/.test(error.message));
    });
});
test("첨부 대기 취소는 추가 요청 없이 종료한다", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        calls++;
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const abort = new AbortController();
    const promise = loadInboxAttachment("/api/inbox/file", undefined, abort.signal);
    abort.abort();
    await assert.rejects(promise, { name: "AbortError" });
    assert.equal(calls, 1);
});
