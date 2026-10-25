import test from "node:test";
import assert from "node:assert/strict";
import { copyNames } from "./names";

test("UX-242·305 이름 찾기: 받아 둔 이름은 '이름 · #번호', 없으면 번호, 규칙 0은 표시 안 함", () => {
    const names = copyNames({
        workspaces: [{ id: 3, name: "가상 사업" }],
        rules: [{ id: 12, name: "첫 메일 규칙" }, { id: 13, name: null }],
        policies: [{ id: 45, name: "지침 A" }],
        knowledge: [{ id: 31, name: "지식 A" }],
    });
    assert.equal(names.workspace(3), "가상 사업");
    assert.equal(names.workspace(9), "사업 #9");
    assert.equal(names.rule(12), "첫 메일 규칙 · #12");
    assert.equal(names.rule(13), "규칙 #13", "이름 없는 규칙");
    assert.equal(names.rule(99), "규칙 #99", "삭제된 규칙");
    assert.equal(names.rule(0), null, "방문 감사(rule_id 0)");
    assert.equal(names.policy(45), "지침 A · #45");
    assert.equal(names.policy(46), "작성 #46", "다른 쪽 버전");
    assert.equal(names.knowledge(31), "지식 A · #31");
    assert.equal(names.knowledge(32), "지식 #32");
});
