import { test } from "node:test";
import assert from "node:assert/strict";
import { moveAttachmentDraftGroup, type FileDraft } from "@/components/inbox/hooks/useAttachmentDrafts";

function draft(clientId: string): FileDraft {
    return { clientId, file: new File(["fictional"], `${clientId}.txt`, { type: "text/plain" }) };
}
test("새 문의를 전송한 뒤 파일 그룹을 이동해 File/업로드 ID/다른 문의 초안을 보존", () => {
    const original = draft("qa-one");
    original.uploaded = { id: "qa-uploaded", fileName: original.file.name, size: original.file.size, contentType: "text/plain" };
    const unrelated = [draft("qa-other")];
    const groups = { new: [original], unrelated };
    const moved = moveAttachmentDraftGroup(groups, "new", "thread");
    assert.deepEqual(moved.new, []);
    assert.equal(moved.thread[0], original);
    assert.equal(moved.thread[0].file, original.file);
    assert.equal(moved.thread[0].uploaded?.id, "qa-uploaded");
    assert.equal(moved.unrelated, unrelated);
    assert.equal(groups.new[0], original);
});
test("동일 clientId 합칠 때 업로드 완료 정보를 우선하며 같은 그룹은 그대로 반환", () => {
    const original = draft("qa-one"), saved = { ...original, uploaded: { id: "qa-uploaded", fileName: "qa-one.txt", size: 9, contentType: "text/plain" } };
    const groups = { from: [saved], to: [original] };
    const moved = moveAttachmentDraftGroup(groups, "from", "to");
    assert.equal(moved.to.length, 1);
    assert.equal(moved.to[0], saved);
    assert.equal(moveAttachmentDraftGroup(groups, "from", "from"), groups);
});
test("5개 제한을 넘는 그룹 이동은 원본과 대상 모두 변경 없이 보류", () => {
    const groups = { from: [draft("a"), draft("b"), draft("c")], to: [draft("d"), draft("e"), draft("f")] };
    const before = { ...groups };
    assert.throws(() => moveAttachmentDraftGroup(groups, "from", "to"), /5개까지/);
    assert.equal(groups.from, before.from);
    assert.equal(groups.to, before.to);
    assert.deepEqual(groups.from.map((v) => v.clientId), ["a", "b", "c"]);
    assert.deepEqual(groups.to.map((v) => v.clientId), ["d", "e", "f"]);
});
