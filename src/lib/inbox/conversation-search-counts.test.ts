import test from "node:test";
import assert from "node:assert/strict";
// 실제 DB에 접속하지 않는다 — 메모리 PGlite에 표 모양만 만들고(마이그레이션 미적용) 집계 질의를 실행한다.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
process.env.JWT_SECRET ??= "fx-search-counts-test-only-not-a-real-secret";
const ORG = "00000000-0000-4000-8000-00000000c001";
const USER = "00000000-0000-4000-8000-00000000c002";
const actor = { orgId: ORG, userId: USER, name: "가상 직원", role: "owner" as const };

test("UX-115 검색어가 있으면 현재 상태 결과와 함께 상태별 검색 건수를 한 번에 돌려준다", async () => {
    const schema = await import("../db/schema");
    const { openPglite, insertRow } = await import("../db/pglite-harness.test-helper");
    const { drizzle } = await import("drizzle-orm/pglite");
    const pg = await openPglite([
        schema.workspaces, schema.users, schema.organizationMembers, schema.inboxChannels, schema.inboxConversations,
        schema.inboxReads, schema.inboxMessages, schema.inboxTeamMembers, schema.inboxMessageMentions,
    ]);
    try {
        await insertRow(pg, "workspaces", { id: 1, org_id: ORG, name: "사업" });
        await insertRow(pg, "users", { id: USER, email: "u@example.test", password: "x", name: "가상 직원" });
        await insertRow(pg, "organization_members", { organization_id: ORG, user_id: USER, role: "owner" });
        await insertRow(pg, "inbox_channels", { id: 1, org_id: ORG, workspace_id: 1, public_key: "k", name: "상담" });
        let n = 0;
        const chat = (name: string, status: string, historyOnly = false) =>
            insertRow(pg, "inbox_conversations", { org_id: ORG, channel_id: 1, token_hash: `h${++n}`, name, status, history_only: historyOnly });
        await chat("홍길동 진행", "open");
        await chat("김철수 진행", "open");
        await chat("홍길동 종료", "closed");
        await chat("홍길동 보류", "snoozed");
        await chat("홍길동 이전", "closed", true);
        const db = drizzle(pg, { schema });
        const { conversationCounts, listConversations } = await import("./repository");
        const plain = await conversationCounts(actor, 1, { status: "open" }, db as never);
        assert.equal(plain.all, 2);
        assert.equal(plain.history, 1);
        assert.equal("searchOpen" in plain, false, "검색어 없으면 기존 응답 그대로");
        const found = await conversationCounts(actor, 1, { status: "open", q: "홍길동" }, db as never);
        assert.equal(found.all, 1, "현재 상태(진행중) 결과");
        assert.equal(found.history, 1);
        assert.deepEqual([found.searchOpen, found.searchSnoozed, found.searchClosed], [1, 1, 1]);
        const closed = await conversationCounts(actor, 1, { status: "closed", q: "김철수" }, db as never);
        assert.equal(closed.all, 0);
        assert.equal(closed.searchOpen, 1, "종료 탭에서 찾는 고객이 진행중에 있음을 알린다");
        const rows = await listConversations(actor, 1, db as never, undefined, undefined, { status: "open", q: "홍길동" });
        assert.deepEqual(rows.map((r) => r.name), ["홍길동 진행"], "목록은 기존처럼 현재 상태만");
    } finally { await pg.close(); }
});
