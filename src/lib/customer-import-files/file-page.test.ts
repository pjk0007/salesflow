// UX-095 — 첨부 목록이 원본 순서로 정렬되고 상태별로 모아 볼 수 있는지(가상 db, SQL 실행 없음).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000095";
const JOB = "00000000-0000-4000-8000-0000000000a5";

test("UX-095 상태 필터는 현재 원본의 해당 상태만, 다음 페이지 여부는 그 건수로 판단한다", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { importFilePage } = await import("./repository");
    // 목록 조회와 건수 조회를 구분해 응답한다
    let call = 0;
    const seen = installFakeDb(t, db, (c) => {
        if (isMembershipLookup(c)) return [{ role: "admin", tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.table === "workspaces") return [{ id: 8 }];
        if (c.table === "customer_imports") return [{ id: JOB, workspaceId: 8, source: "channel", namespace: "n", state: "completed", version: 3, fingerprint: "x" }];
        if (c.table !== "customer_import_files") return [];
        call++;
        return call === 1
            ? Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, sourceUrl: null, leaseToken: null, state: "pending", leaseUntil: null }))
            : [
                  { state: "pending", active: true, count: 150 },
                  { state: "pending", active: false, count: 900 },
                  { state: "ready", active: true, count: 1000 },
              ];
    });
    const page = await importFilePage({ orgId: ORG, userId: "u", name: "가상", role: "admin" } as never, JOB, 100, db as never, "pending");
    const list = seen.calls.find((c) => c.table === "customer_import_files")!;
    assert.match(list.sql, /"state" = \$\d+/);
    assert.match(list.sql, /"active" = \$\d+/);
    assert.ok(list.params.includes("pending") && list.params.includes(true));
    assert.equal(page.total, 2050);
    // 대기·현재 원본 150개 중 100~199 → 다음 페이지 없음(전체 2050개 기준이면 있다고 잘못 판단)
    assert.equal(page.hasMore, false);

    call = 0;
    seen.calls.length = 0;
    const all = await importFilePage({ orgId: ORG, userId: "u", name: "가상", role: "admin" } as never, JOB, 100, db as never);
    assert.doesNotMatch(seen.calls.find((c) => c.table === "customer_import_files")!.sql, /"state" =/);
    assert.equal(all.hasMore, true);
});
