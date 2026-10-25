import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv } from "../auth-fake-db.test-helper";

test("UX-121 첨부 한도 초과 안내는 고객과 직원에게 다르게, 한도 미만은 기존 경로", async (t) => {
    isolateEnv(t, { INBOX_ATTACHMENT_QUOTA_MB: "20" });
    const { db } = await import("../db");
    const { uploadAttachment } = await import("./files");
    let used = 20 * 1024 * 1024;
    const { calls } = installFakeDb(t, db, (call) => {
        if (call.op === "select" && call.table === "inbox_attachments" && call.sql.includes("storage_object_key"))
            return [{ bytes: used, drafts: 0 }];
        if (call.op === "insert") return [{ id: "f1", fileName: "a.txt", contentType: "text/plain", size: 3 }];
        return [];
    });
    const scope = { orgId: "00000000-0000-4000-8000-000000000001", channelId: 1, ownerKey: "owner", publicOnly: true };
    const file = { clientId: "00000000-0000-4000-8000-0000000000aa", kind: "customer", fileName: "a.txt", bytes: Buffer.from("abc") };
    await assert.rejects(uploadAttachment(scope as never, file), (e: Error & { status?: number }) => {
        assert.equal(e.status, 413);
        assert.match(e.message, /파일 없이 메시지로/);
        assert.doesNotMatch(e.message, /관리자/);
        return true;
    });
    await assert.rejects(uploadAttachment({ ...scope, publicOnly: false } as never, { ...file, kind: "reply" }), /사이트 상담창 설정에서 사용량/);
    assert.equal(calls.filter((c) => c.op === "insert").length, 0);
    used = 0;
    const saved = await uploadAttachment(scope as never, file).catch((e) => e);
    assert.ok(!(saved instanceof Error) || !/한도/.test(saved.message), "한도 미만은 한도 오류 없음");
});
