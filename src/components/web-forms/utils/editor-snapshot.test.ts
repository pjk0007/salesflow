import test from "node:test";
import assert from "node:assert/strict";
import { unlinkedFields, webFormEditorSnapshot, type WebFormEditorValues } from "./editor-snapshot";

const field = (over: Partial<WebFormEditorValues["fields"][number]> = {}) => ({
    tempId: "t1", label: "이름", description: "", placeholder: "", fieldType: "text",
    linkedFieldKey: "name", isRequired: false, options: [], ...over,
});
const base = (over: Partial<WebFormEditorValues> = {}): WebFormEditorValues => ({
    name: "폼", title: "제목", description: "", completionTitle: "완료", completionMessage: "",
    completionButtonText: "", completionButtonUrl: "", coverImageUrl: "", coverColor: "",
    defaultValues: [], fields: [field()], ...over,
});

test("UX-048 미저장 판단 — 화면용 tempId·저장 후 받은 서버 id는 변경이 아니고, 질문·설정 변경은 변경이다", () => {
    const saved = webFormEditorSnapshot(base());
    assert.equal(webFormEditorSnapshot(base({ fields: [field({ tempId: "other", id: 31 })] })), saved);
    assert.notEqual(webFormEditorSnapshot(base({ fields: [field({ label: "성함" })] })), saved);
    assert.notEqual(webFormEditorSnapshot(base({ fields: [field(), field({ tempId: "t2" })] })), saved);
    assert.notEqual(webFormEditorSnapshot(base({ coverColor: "#1e293b" })), saved);
    assert.notEqual(webFormEditorSnapshot(base({ defaultValues: [{ field: "source", value: "웹" }] })), saved);
});

test("UX-045 연결 속성이 없는 질문만 골라 저장 전 확인에 쓴다", () => {
    const fields = [field(), field({ tempId: "t2", label: "문의 내용", linkedFieldKey: "" })];
    assert.deepEqual(unlinkedFields(fields).map((f) => f.label), ["문의 내용"]);
    assert.deepEqual(unlinkedFields([field()]), []);
});
