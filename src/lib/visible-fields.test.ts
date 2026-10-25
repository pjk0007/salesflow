import test from "node:test";
import assert from "node:assert/strict";
import {
    addVisibleFieldKeys,
    isAllFieldsVisible,
    isFieldVisible,
    removeVisibleFieldKey,
    toggleVisibleField,
} from "./visible-fields";

const ALL = ["name", "phone", "memo"];

test("UX-067 null과 빈 배열은 전체 표시로 같게 판정한다", () => {
    assert.equal(isAllFieldsVisible(null), true);
    assert.equal(isAllFieldsVisible([]), true);
    assert.equal(isAllFieldsVisible(["name"]), false);
    assert.equal(isFieldVisible([], "memo"), true);
    assert.equal(isFieldVisible(["name"], "memo"), false);
});

test("UX-067 속성 추가: 전체 표시 파티션은 건드리지 않고, 명시 목록에만 새 key를 더한다", () => {
    assert.equal(addVisibleFieldKeys(null, ["new"]), null);
    assert.equal(addVisibleFieldKeys([], ["new"]), null, "빈 배열을 [new]로 바꿔 나머지 열을 숨기지 않는다");
    assert.deepEqual(addVisibleFieldKeys(["name"], ["new"]), ["name", "new"]);
    assert.equal(addVisibleFieldKeys(["name", "new"], ["new"]), null, "이미 있으면 변경 없음");
    assert.deepEqual(addVisibleFieldKeys(["name"], ["a", "name", "b"]), ["name", "a", "b"]);
});

test("UX-067 속성 삭제: 목록에서 빼고, 마지막 열이면 전체 표시(null)로", () => {
    assert.equal(removeVisibleFieldKey(null, "name"), undefined);
    assert.equal(removeVisibleFieldKey(["phone"], "name"), undefined);
    assert.deepEqual(removeVisibleFieldKey(["name", "phone"], "name"), ["phone"]);
    assert.equal(removeVisibleFieldKey(["name"], "name"), null);
});

test("UX-067 열 토글: 전체 표시에서 숨기면 나머지를 담고, 다시 모두 보이면 null, 마지막 열은 숨기지 않는다", () => {
    assert.deepEqual(toggleVisibleField(null, ALL, "memo", false), ["name", "phone"]);
    assert.deepEqual(toggleVisibleField([], ALL, "memo", false), ["name", "phone"], "빈 배열에서 숨기기도 실제로 숨긴다");
    assert.equal(toggleVisibleField(["name", "phone"], ALL, "memo", true), null, "모두 보이면 전체 표시로");
    assert.equal(toggleVisibleField(["name"], ALL, "name", false), undefined, "마지막 열");
    // 다른 속성 타입의 남은 key는 정리한다
    assert.deepEqual(toggleVisibleField(["name", "legacy"], ALL, "phone", true), ["name", "phone"]);
});
