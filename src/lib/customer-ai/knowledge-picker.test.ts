// UX-301 — 설정 선택기용 지식 조회: 승인·고객 상담 목적 조건과 이름 검색(와일드카드 이스케이프), 커서를 함께 건다.
// 가상 db로 SQL·매개변수만 확인한다(실제 jsonb 조건 실행 검증은 아님).
import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000001";
const actor = { userId: "00000000-0000-4000-8000-000000000002", orgId: ORG, name: "가상", role: "admin" } as never;

test("UX-301 승인·상담 목적·이름 검색·커서 조건", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { listSupportKnowledge } = await import("./catalog");
    const { calls } = installFakeDb(t, db, (call) => {
        if (isMembershipLookup(call)) return [{ role: "admin", tokenVersion: 0, membershipId: 71, isActive: 1 }];
        if (call.table === "workspaces") return [{ id: 3 }];
        return [];
    });
    await listSupportKnowledge(actor, 3, 120, db, { approvedForChat: true, q: "가격_100%" });
    const query = calls.filter((c) => c.table === "ai_copy_knowledge_versions").at(-1)!;
    assert.match(query.sql, /jsonb_array_elements/);
    assert.match(query.sql, /customer_chat/);
    assert.match(query.sql, /ilike/i);
    assert.ok(query.params.includes("approved"), "승인 상태만");
    assert.ok(query.params.includes("%가격\\_100\\%%"), "검색어의 _·%는 문자 그대로");
    assert.ok(query.params.includes(120) && query.params.includes(ORG) && query.params.includes(3));
});

test("UX-301 필터 없는 기존 관리 목록 조회는 조건을 추가하지 않는다", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { listSupportKnowledge } = await import("./catalog");
    const { calls } = installFakeDb(t, db, (call) => {
        if (isMembershipLookup(call)) return [{ role: "admin", tokenVersion: 0, membershipId: 71, isActive: 1 }];
        if (call.table === "workspaces") return [{ id: 3 }];
        return [];
    });
    await listSupportKnowledge(actor, 3);
    const query = calls.filter((c) => c.table === "ai_copy_knowledge_versions").at(-1)!;
    assert.doesNotMatch(query.sql, /jsonb_array_elements|ilike/i);
    assert.ok(!query.params.includes("approved"));
});
