import { test } from "node:test";
import assert from "node:assert/strict";
import { CustomerConversationController } from "./controller";
import type { CustomerConversationPage, CustomerReadAck } from "../types";
import { InboxRequestError } from "@/components/inbox/api";
const ack: CustomerReadAck = { lastMessageId: 5, readRevision: 0, unread: 0 };

function row(id: string, at = "2026-10-15T01:00:00.000Z") {
    return {
        id,
        title: `가상 문의 ${id}`,
        preview: "가상 답변",
        status: "open" as const,
        isCurrent: false,
        lastMessageAt: at,
        unread: 1,
    };
}
function page(ids: string[], next: string | null = null): CustomerConversationPage {
    return { rows: ids.map((id) => row(id)), hasMore: !!next, nextBefore: next, unreadCount: 3 };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
test("문의 선택/새 문의/목록은 네트워크 생성이나 읽음 없이 이동", () => {
    let calls = 0;
    const c = new CustomerConversationController({
        page: async () => { calls++; return page([]); },
        read: async () => { calls++; return ack; },
    });
    c.open("qa-thread");
    assert.equal(c.getSnapshot().view, "thread");
    assert.equal(c.getSnapshot().conversationId, "qa-thread");
    c.showList();
    assert.equal(c.getSnapshot().conversationId, "qa-thread");
    c.newInquiry();
    assert.equal(c.getSnapshot().view, "new");
    assert.equal(c.getSnapshot().conversationId, undefined);
    c.reset();
    assert.equal(c.getSnapshot().view, "current");
    assert.equal(calls, 0);
});
test("추가 페이지 중복 ID 제거와 최신 첫 페이지만 갱신, 이전 페이지 보존", async () => {
    const calls: (string | undefined)[] = [];
    let first = page(["z", "y"], "y");
    const c = new CustomerConversationController({
        page: async (_token, before) => {
            calls.push(before);
            return before ? page(["y", "x"]) : first;
        },
        read: async () => ack,
    });
    c.activate("qa-jwt");
    await c.refresh();
    await c.loadMore();
    first = page(["w", "z"], "z");
    first.rows[0].lastMessageAt = "2026-10-16T01:00:00.000Z";
    first.rows[1].unread = 0;
    await c.refresh();
    assert.deepEqual(c.getSnapshot().rows.map((v) => v.id), ["w", "z", "y", "x"]);
    assert.equal(c.getSnapshot().rows[1].unread, 0);
    assert.equal(c.getSnapshot().hasMore, false);
    assert.deepEqual(calls, [undefined, "y", undefined]);
});
test("동시 목록/추가 페이지 요청을 중복 실행하지 않음", async () => {
    const first = deferred<CustomerConversationPage>();
    let requests = 0;
    const c = new CustomerConversationController({
        page: async () => { requests++; return first.promise; },
        read: async () => ack,
    });
    c.activate("qa-jwt");
    const a = c.refresh(), b = c.refresh();
    assert.equal(a, b);
    first.resolve(page([]));
    await a;
    assert.equal(requests, 1);
    assert.equal(c.getSnapshot().loading, false);
});
test("인증 갱신은 선택을 유지하며 이전 인증의 늦은 응답은 폐기", async () => {
    const old = deferred<CustomerConversationPage>();
    const tokens: string[] = [];
    const c = new CustomerConversationController({
        page: async (token) => {
            tokens.push(token);
            return token === "old" ? old.promise : page(["fresh"]);
        },
        read: async () => ack,
    });
    c.activate("old");
    c.open("selected");
    const pending = c.refresh();
    c.deactivate();
    c.activate("new");
    await c.refresh();
    old.resolve(page(["stale"]));
    await pending;
    assert.equal(c.getSnapshot().conversationId, "selected");
    assert.deepEqual(c.getSnapshot().rows.map((v) => v.id), ["fresh"]);
    assert.deepEqual(tokens, ["old", "new"]);
    assert.equal(c.getSnapshot().loading, false);
});
test("다른 회원 컨트롤러는 목록/선택/읽음 캐시가 비어 있으며 이전 응답을 받지 않음", async () => {
    const transport = { page: async () => page(["member-a"]), read: async () => ack };
    const a = new CustomerConversationController(transport);
    a.activate("member-a");
    await a.refresh();
    a.open("member-a");
    const b = new CustomerConversationController(transport);
    assert.deepEqual(b.getSnapshot().rows, []);
    assert.equal(b.getSnapshot().view, "current");
    assert.equal(b.getSnapshot().conversationId, undefined);
});
test("읽음 중복 요청/성공 캐시는 중복 제거, 실패는 같은 번호로 재시도", async () => {
    const read = deferred<CustomerReadAck>();
    let fail = true, calls = 0;
    const c = new CustomerConversationController({
        page: async () => page([]),
        read: async () => {
            calls++;
            if (fail) throw new Error("가상 연결 실패");
            return read.promise;
        },
    });
    c.activate("qa-jwt");
    await assert.rejects(c.markSeen("thread", 5), /가상 연결 실패/);
    fail = false;
    const a = c.markSeen("thread", 5), b = c.markSeen("thread", 5);
    assert.equal(a, b);
    read.resolve(ack);
    await a;
    await c.markSeen("thread", 5);
    await c.markSeen("thread", 4);
    assert.equal(calls, 2);
});
test("추가 페이지 실패는 기존 목록과 커서를 보존해서 재시도", async () => {
    let fail = true;
    const c = new CustomerConversationController({
        page: async (_token, before) => {
            if (!before) return page(["z"], "z");
            if (fail) throw new Error("가상 오프라인");
            return page(["y"]);
        },
        read: async () => ack,
    });
    c.activate("qa-jwt");
    await c.refresh();
    await c.loadMore();
    assert.equal(c.getSnapshot().error?.message, "가상 오프라인");
    assert.deepEqual(c.getSnapshot().rows.map((v) => v.id), ["z"]);
    assert.equal(c.getSnapshot().hasMore, true);
    fail = false;
    await c.loadMore();
    assert.equal(c.getSnapshot().error, undefined);
    assert.deepEqual(c.getSnapshot().rows.map((v) => v.id), ["z", "y"]);
});
test("같은 마지막 ID의 새 병합 revision은 별도 읽음 요청하고 이전 문의 행에 서버 unread 적용", async () => {
    const revisions: (number | undefined)[] = [];
    const c = new CustomerConversationController({
        page: async (_token, before) => before ? page(["x"]) : page(["z"], "z"),
        read: async (_token, _id, lastMessageId, readRevision) => {
            revisions.push(readRevision);
            return { lastMessageId, readRevision: readRevision ?? 0, unread: readRevision === 2 ? 0 : 1 };
        },
    });
    c.activate("qa-jwt");
    await c.refresh();
    await c.loadMore();
    await c.markSeen("x", 15, 1);
    await c.markSeen("x", 15, 1);
    await c.markSeen("x", 15, 2);
    assert.deepEqual(revisions, [1, 2]);
    assert.equal(c.getSnapshot().rows.find((r) => r.id === "x")?.unread, 0);
});

for (const status of [401, 403, 404]) {
    test(`목록 ${status}은 확장 캐시의 제목·미리보기를 숨기고 선택은 보존`, async () => {
        let denied = false;
        const c = new CustomerConversationController({
            page: async (_token, before) => {
                if (denied) throw new InboxRequestError("가상 접근 거절", status);
                return before ? page(["old-history"]) : page(["current"], "next");
            },
            read: async () => ack,
        });
        c.activate("fictional-owner");
        await c.refresh();
        await c.loadMore();
        c.open("current");
        denied = true;
        await c.refresh();
        assert.deepEqual(c.getSnapshot().rows, []);
        assert.equal(c.getSnapshot().conversationId, "current");
        assert.equal(c.getSnapshot().hasMore, false);
        assert.equal(c.getSnapshot().loading, false);
        denied = false;
        await c.refresh();
        assert.deepEqual(c.getSnapshot().rows.map((r) => r.id), ["current"]);
    });
}

test("일시적 목록 503은 공개 캐시와 더보기 커서를 유지", async () => {
    let unavailable = false;
    const c = new CustomerConversationController({
        page: async (_token, before) => {
            if (unavailable) throw new InboxRequestError("가상 일시 장애", 503);
            return before ? page(["older"]) : page(["current"], "next");
        },
        read: async () => ack,
    });
    c.activate("fictional-owner");
    await c.refresh();
    const cached = c.getSnapshot().rows;
    unavailable = true;
    await c.refresh();
    assert.equal(c.getSnapshot().rows, cached);
    assert.equal(c.getSnapshot().hasMore, true);
    unavailable = false;
    await c.loadMore();
    assert.deepEqual(c.getSnapshot().rows.map((r) => r.id), ["older", "current"]);
});

test("거절된 선택행만 제거하고 늦은 확장 페이지가 복원하지 못함", async () => {
    const late = deferred<CustomerConversationPage>();
    let requests = 0;
    const c = new CustomerConversationController({
        page: async (_token, before) => {
            requests++;
            if (requests === 1) return page(["current", "archive"], "next");
            if (requests === 2) return page(["valid-older"], "more");
            if (before) return late.promise;
            return page(["current"], "next");
        },
        read: async () => ack,
    });
    c.activate("fictional-owner");
    await c.refresh();
    await c.loadMore();
    c.open("archive");
    const oldRequest = c.loadMore();
    c.invalidate("archive");
    await c.refresh();
    late.resolve(page(["archive", "late-secret-preview"]));
    await oldRequest;
    assert.deepEqual(c.getSnapshot().rows.map((r) => r.id), ["valid-older", "current"]);
    assert.equal(c.getSnapshot().conversationId, "archive");
});
