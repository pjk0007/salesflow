import test from "node:test";
import assert from "node:assert/strict";
import { inboxDraftStorageKey, moveInboxDraft } from "./draft-storage";
const memory = () => {
    const map = new Map<string, string>();
    return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};
test("UX-116 병합된 비회원 상담의 초안을 회원 상담으로 옮기고 기존 초안은 보존한다", () => {
    const s = memory();
    s.setItem(inboxDraftStorageKey("u", "src"), JSON.stringify({ "src:reply": "작성 중 답변", "src:note": "" }));
    s.setItem(inboxDraftStorageKey("u", "dst"), JSON.stringify({ "dst:reply": "기존 답변", "dst:note": "메모" }));
    assert.equal(moveInboxDraft(s, "u", "src", "dst"), true);
    assert.deepEqual(JSON.parse(s.getItem(inboxDraftStorageKey("u", "dst"))!), { "dst:reply": "기존 답변\n\n작성 중 답변", "dst:note": "메모" });
    assert.equal(s.getItem(inboxDraftStorageKey("u", "src")), null);
    assert.equal(moveInboxDraft(s, "u", "none", "dst"), false, "옮길 초안이 없으면 대상 그대로");
    s.setItem(inboxDraftStorageKey("u", "bad"), "{");
    assert.equal(moveInboxDraft(s, "u", "bad", "dst"), false, "깨진 저장값은 무시");
});
