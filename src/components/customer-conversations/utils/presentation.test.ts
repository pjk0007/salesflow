import assert from "node:assert/strict";
import { test } from "node:test";
import { customerConversationTimestamp, isReadOnlyCustomerConversation } from "./presentation";

test("과거 공개 DTO의 두 플래그가 불일치해도 읽기 전용을 유지", () => {
    assert.equal(isReadOnlyCustomerConversation({ historyOnly: true, readOnly: false }), true);
    assert.equal(isReadOnlyCustomerConversation({ historyOnly: false, readOnly: true }), true);
    assert.equal(isReadOnlyCustomerConversation({ historyOnly: true, readOnly: true }), true);
    assert.equal(isReadOnlyCustomerConversation({ historyOnly: false, readOnly: false }), false);
    assert.equal(isReadOnlyCustomerConversation({}), false);
    assert.equal(isReadOnlyCustomerConversation(undefined), false);
});

test("과거 상담 원래 시각은 연도와 날짜·시간을 함께 표시하고 잘못된 시각은 비움", () => {
    const timestamp = customerConversationTimestamp("2024-02-15T01:02:00.000Z");
    assert.match(timestamp, /2024/);
    assert.match(timestamp, /2/);
    assert.match(timestamp, /15/);
    assert.match(timestamp, /:/);
    assert.equal(customerConversationTimestamp("not-a-date"), "");
});
