// UX-090·091 — 가져오기 실패·CSV 형식 오류가 어느 행인지 알려 주는지. DB·네트워크를 쓰지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { isolateEnv } from "../auth-fake-db.test-helper";

test("UX-090 실패 사유에 행 번호·종류·원본 ID와 원인을 남긴다", async (t) => {
    isolateEnv(t);
    const { importFailure } = await import("./repository");
    const { ImportRowError } = await import("./batch-writer");
    const { InboxError } = await import("../inbox/errors");
    const row = { index: 41, kind: "contacts" as const, sourceId: "member-7" };

    const relation = importFailure(new ImportRowError(row, new InboxError("검토하지 않은 자료 관계입니다.", 409)));
    assert.deepEqual(relation.row, row);
    assert.equal(relation.reason, "자료 42행(contacts/member-7)에서 멈췄습니다. 검토하지 않은 자료 관계입니다.");

    const invalid = z.object({ email: z.string().email() }).safeParse({ email: "x" });
    assert.equal(invalid.success, false);
    const zod = importFailure(new ImportRowError(row, invalid.error));
    assert.match(zod.reason, /^자료 42행\(contacts\/member-7\)에서 멈췄습니다\. /);
    assert.doesNotMatch(zod.reason, /Invalid|email:/);

    const unique = importFailure(new ImportRowError(row, Object.assign(new Error("duplicate key"), { code: "23505" })));
    assert.match(unique.reason, /같은 대상이 이미 저장돼 있습니다/);

    // 행 밖(트랜잭션·잠금) 실패는 기존 문구 그대로, 행 정보 없음
    const outside = importFailure(new Error("connection reset"));
    assert.equal(outside.row, null);
    assert.equal(outside.reason, "자료 저장에 실패했습니다. 이번 묶음은 적용하지 않았습니다. 원인을 확인한 뒤 재개해주세요.");
});

test("UX-091 CSV 형식 오류는 파일의 문제 행 번호를 알려 준다", async () => {
    const { normalizeImport } = await import("./adapters");
    const { createImportInput } = await import("./rules");
    const csv = (content: string) =>
        createImportInput.parse({
            workspaceId: 8,
            source: "portable",
            namespace: "test",
            format: "csv",
            csvKind: "contacts",
            columns: { id: "id", name: "name" },
            content,
        });
    assert.throws(
        () => normalizeImport(csv('id,name\n1,가상\n2,"닫히지 않은 따옴표\n')),
        (error: Error) => /문제 행: 3행/.test(error.message),
    );
    assert.throws(
        () => normalizeImport(csv("id,name\n1,가상\n2,가상,남는 열\n3,가상\n")),
        (error: Error) => /문제 행: 3행/.test(error.message),
    );
    assert.equal(normalizeImport(csv("id,name\n1,가상\n")).rows.length, 1);
});
