import test from "node:test";
import assert from "node:assert/strict";
import { InboxRequestError } from "../api";
import { isWidgetAccessDenied } from "./widget-errors";
test("UX-111 권한·세션 오류만 접근 차단으로 보고 일시 오류는 재시도 대상으로 둔다", () => {
    for (const status of [401, 403, 404]) assert.equal(isWidgetAccessDenied(new InboxRequestError("x", status)), true);
    for (const status of [0, 408, 429, 500, 502]) assert.equal(isWidgetAccessDenied(new InboxRequestError("x", status)), false);
    assert.equal(isWidgetAccessDenied(new Error("x")), false);
    assert.equal(isWidgetAccessDenied(undefined), false);
});
