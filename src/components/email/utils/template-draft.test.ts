// UX-142·147 — 템플릿 편집기 저장 기준: 모든 저장 필드로 변경을 판단하고, 발행 템플릿은 임시저장(자동·수동)하지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canSaveAsDraft, isSnapshotDirty, type TemplateSnapshot } from "./template-draft";

const saved: TemplateSnapshot = {
    name: "환영", subject: "안녕하세요", htmlBody: "<p>본문</p>", templateType: "", categoryId: 3, useUnsubscribe: false,
};

test("UX-142: 수신거부·카테고리 단독 변경도 변경으로 본다", () => {
    assert.equal(isSnapshotDirty(saved, { ...saved }), false);
    assert.equal(isSnapshotDirty(saved, { ...saved, useUnsubscribe: true }), true);
    assert.equal(isSnapshotDirty(saved, { ...saved, categoryId: null }), true);
    assert.equal(isSnapshotDirty(saved, { ...saved, templateType: "notice" }), true);
    assert.equal(isSnapshotDirty(saved, { ...saved, htmlBody: "<p>바뀜</p>", categoryId: 4 }), true);
    // 저장 뒤에는 새 기준과 같으므로 변경 없음
    const after = { ...saved, useUnsubscribe: true };
    assert.equal(isSnapshotDirty(after, { ...after }), false);
});

test("UX-142: 저장 기준이 없는 새 템플릿은 내용이 있을 때만 변경", () => {
    const empty = { ...saved, name: "", subject: "", htmlBody: "" };
    assert.equal(isSnapshotDirty(null, empty), false);
    assert.equal(isSnapshotDirty(null, { ...empty, subject: "제목" }), true);
});

test("UX-147: 발행 템플릿은 임시저장하지 않고, 새 템플릿·초안만 한다", () => {
    assert.equal(canSaveAsDraft("published"), false);
    assert.equal(canSaveAsDraft("draft"), true);
    assert.equal(canSaveAsDraft(undefined), true);
    assert.equal(canSaveAsDraft(null), true);
});
