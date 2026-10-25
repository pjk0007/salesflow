import test from "node:test";
import assert from "node:assert/strict";
import { connectionResultMessage, connectionSucceeded } from "./connection-result";
test("UX-128 실패 코드마다 다른 안내를 보이고 모르는 값은 일반 실패로 본다", () => {
    const codes = ["connected", "cancelled", "expired", "scope", "account", "alias", "permission", "failed"];
    const texts = codes.map(connectionResultMessage);
    assert.equal(new Set(texts).size, codes.length);
    assert.equal(connectionResultMessage("<script>"), connectionResultMessage("failed"));
    assert.equal(connectionSucceeded("connected"), true);
    assert.equal(connectionSucceeded("scope"), false);
});
