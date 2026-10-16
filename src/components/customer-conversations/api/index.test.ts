import { test } from "node:test";
import assert from "node:assert/strict";
import { customerConversationApi } from "./index";
import { InboxRequestError } from "@/components/inbox/api";

test("목록/더보기는 고객 Bearer 인증만 사용하고 문의 ID·커서를 인코딩", async (t) => {
    const calls: { url: string; options?: RequestInit }[] = [];
    t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options?: RequestInit) => {
        calls.push({ url: String(url), options });
        return Response.json({ success: true, data: { rows: [], hasMore: false, nextBefore: null, unreadCount: 0 } });
    });
    const api = customerConversationApi("qa/key");
    await api.page("fictional-token");
    await api.page("fictional-token", "cursor?not-a-query");
    assert.equal(calls[0].url, "/api/messenger/qa%2Fkey/conversations");
    assert.equal(calls[1].url, "/api/messenger/qa%2Fkey/conversations?before=cursor%3Fnot-a-query");
    assert.equal((calls[0].options?.headers as Record<string, string>).Authorization, "Bearer fictional-token");
    assert.equal(calls[0].options?.cache, "no-store");
    assert.equal(calls[0].options?.body, undefined);
    assert.ok(calls[0].options?.signal);
});
test("읽음은 지정 문의의 공개 메시지 번호만 POST하고 서버 권한 오류 보존", async (t) => {
    let request: { url: string; options?: RequestInit } | undefined;
    t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options?: RequestInit) => {
        request = { url: String(url), options };
        return Response.json({ success: false, error: "해당 문의에 접근할 수 없습니다." }, { status: 403 });
    });
    await assert.rejects(
        customerConversationApi("qa-key").read("fictional-token", "thread/id", 15, 2),
        (error: unknown) => error instanceof InboxRequestError && error.status === 403,
    );
    assert.equal(request?.url, "/api/messenger/qa-key/conversations/thread%2Fid/read");
    assert.equal(request?.options?.method, "POST");
    assert.deepEqual(JSON.parse(String(request?.options?.body)), { lastMessageId: 15, readRevision: 2 });
});
test("네트워크/시간 초과 오류에 한국어 재시도 안내", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
        throw new DOMException("Timed out", "TimeoutError");
    });
    await assert.rejects(customerConversationApi("qa-key").page("fictional-token"), /잠시 뒤 다시 시도/);
});
