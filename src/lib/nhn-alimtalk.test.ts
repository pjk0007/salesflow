import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "./auth-fake-db.test-helper";

// 가상 공급자 응답(fetch 대체)만 쓴다. 실제 NHN 호출 없음.
test("UX-268: 쪽 지정 없는 발신 프로필 목록은 totalCount까지 모든 쪽을 모은다", async t => {
    isolateEnv(t);
    const { NhnAlimtalkClient } = await import("./nhn-alimtalk");
    const total = 1003;
    const urls: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: unknown) => {
        const u = new URL(String(url));
        urls.push(u.search);
        const pageNum = Number(u.searchParams.get("pageNum") ?? 1), pageSize = Number(u.searchParams.get("pageSize") ?? 15);
        const start = (pageNum - 1) * pageSize;
        const senders = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => ({ senderKey: `fake-${start + i}`, plusFriendId: `@fake${start + i}` }));
        return Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "" }, senders, totalCount: total });
    });
    const client = new NhnAlimtalkClient("fake-app", "fake-secret");
    const result = await client.listSenders();
    assert.equal(result.senders.length, total);
    assert.equal(result.totalCount, total);
    assert.deepEqual(urls, ["?pageNum=1&pageSize=1000", "?pageNum=2&pageSize=1000"]);
    // 15건 이하 조직은 요청 1회
    urls.length = 0;
    t.mock.method(globalThis, "fetch", async (url: unknown) => {
        urls.push(new URL(String(url)).search);
        return Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "" }, senders: [{ senderKey: "a" }, { senderKey: "b" }], totalCount: 2 });
    });
    const small = await client.listSenders();
    assert.equal(small.senders.length, 2);
    assert.equal(urls.length, 1);
    // 지정한 쪽은 그대로 한 번만
    urls.length = 0;
    await client.listSenders({ pageNum: 2, pageSize: 10 });
    assert.deepEqual(urls, ["?pageNum=2&pageSize=10"]);
});

test("UX-268: 공급자 실패 쪽에서 멈추고 header를 그대로 돌려준다", async t => {
    isolateEnv(t);
    const { NhnAlimtalkClient } = await import("./nhn-alimtalk");
    t.mock.method(globalThis, "fetch", async () => new Response("", { status: 500, statusText: "fake" }));
    const result = await new NhnAlimtalkClient("fake-app", "fake-secret").listSenders();
    assert.equal(result.header.isSuccessful, false);
    assert.equal(result.senders.length, 0);
});
