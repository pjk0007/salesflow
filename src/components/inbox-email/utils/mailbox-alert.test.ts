import test from "node:test";
import assert from "node:assert/strict";
import { mailboxAlert } from "./mailbox-alert";
const box = (over: object) => ({ id: "b", workspaceId: 1, address: "a@example.test", name: "a", enabled: true, version: 1, ...over });
test("UX-126 정상·미연결·재연결 필요·자동 처리 꺼짐을 구분한다", () => {
    assert.deepEqual(mailboxAlert(undefined), { reconnectCount: 0, workerStopped: false });
    assert.deepEqual(mailboxAlert([box({ connectionStatus: "connected", workerEnabled: true })]), { reconnectCount: 0, workerStopped: false }, "정상");
    assert.deepEqual(mailboxAlert([box({ connectionStatus: null })]), { reconnectCount: 0, workerStopped: false }, "미연결은 경고 없음");
    assert.deepEqual(mailboxAlert([box({ connectionStatus: "reconnect" }), box({ connectionStatus: "reconnect" })]).reconnectCount, 2);
    assert.equal(mailboxAlert([box({ connectionStatus: "connected", workerEnabled: false })]).workerStopped, true);
    assert.equal(mailboxAlert([box({ connectionStatus: "connected", workerEnabled: false, enabled: false })]).workerStopped, false, "중지한 메일함은 제외");
});
