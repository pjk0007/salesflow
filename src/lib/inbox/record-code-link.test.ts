import test from "node:test";
import assert from "node:assert/strict";
// 실제 DB에 접속하지 않는다 — 메모리 PGlite에 표 모양만 만들고(마이그레이션 미적용) 조회를 실행한다.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
process.env.JWT_SECRET ??= "fx-record-code-test-only-not-a-real-secret";
const ORG = "00000000-0000-4000-8000-00000000a001";
const OTHER = "00000000-0000-4000-8000-00000000a002";
const CHAT = "00000000-0000-4000-8000-00000000a003";
const actor = { orgId: ORG, userId: "00000000-0000-4000-8000-00000000a004", name: "가상", role: "owner" as const };

test("UX-113 통합코드는 이 상담 채널과 같은 사업·조직의 레코드로만 바꾼다", async () => {
    const schema = await import("../db/schema");
    const { openPglite, insertRow } = await import("../db/pglite-harness.test-helper");
    const { drizzle } = await import("drizzle-orm/pglite");
    const pg = await openPglite([schema.records, schema.partitions, schema.inboxConversations, schema.inboxChannels]);
    try {
        await insertRow(pg, "inbox_channels", { id: 1, org_id: ORG, workspace_id: 1, public_key: "k", name: "상담" });
        await insertRow(pg, "inbox_conversations", { id: CHAT, org_id: ORG, channel_id: 1, token_hash: "h", name: "고객" });
        await insertRow(pg, "partitions", { id: 10, workspace_id: 1, name: "같은 사업" });
        await insertRow(pg, "partitions", { id: 20, workspace_id: 2, name: "다른 사업" });
        await insertRow(pg, "records", { id: 100, org_id: ORG, workspace_id: 1, partition_id: 10, integrated_code: "SALES-0012", data: "{}" });
        await insertRow(pg, "records", { id: 200, org_id: ORG, workspace_id: 2, partition_id: 20, integrated_code: "SALES-0099", data: "{}" });
        await insertRow(pg, "records", { id: 300, org_id: OTHER, workspace_id: 1, partition_id: 10, integrated_code: "SALES-0077", data: "{}" });
        await insertRow(pg, "records", { id: 400, org_id: ORG, workspace_id: 1, partition_id: 10, integrated_code: "DUP-0001", data: "{}" });
        await insertRow(pg, "records", { id: 401, org_id: ORG, workspace_id: 1, partition_id: 10, integrated_code: "DUP-0001", data: "{}" });
        const db = drizzle(pg, { schema });
        const { recordIdByCode } = await import("./repository");
        assert.equal(await recordIdByCode(actor, CHAT, "sales-0012", db as never), 100, "대소문자 무관");
        await assert.rejects(recordIdByCode(actor, CHAT, "SALES-0099", db as never), /찾을 수 없습니다/, "다른 사업");
        await assert.rejects(recordIdByCode(actor, CHAT, "SALES-0077", db as never), /찾을 수 없습니다/, "다른 조직");
        await assert.rejects(recordIdByCode(actor, CHAT, "DUP-0001", db as never), /여러 명/, "중복 코드는 번호로 안내");
        const { patchInput } = await import("./rules");
        assert.equal(patchInput.safeParse({ recordCode: "A-1", recordId: 1 }).success, false);
        assert.equal(patchInput.safeParse({ recordCode: "A-1", version: 1 }).success, true);
    } finally { await pg.close(); }
});
