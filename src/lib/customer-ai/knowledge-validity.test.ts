import test from "node:test";
import assert from "node:assert/strict";
import { isUsableSupportClaim } from "./knowledge-validity";
test("UX-171 상담 근거 90일 경계·미래 확인일·메일 전용을 같은 규칙으로 판정한다", () => {
    const now = Date.parse("2026-10-25T00:00:00Z");
    const claim = { purposes: ["customer_chat"], checkedAt: new Date(now - 90 * 86400000).toISOString() };
    assert.equal(isUsableSupportClaim(claim, now), true);
    assert.equal(isUsableSupportClaim({ ...claim, checkedAt: new Date(now - 90 * 86400000 - 1).toISOString() }, now), false);
    assert.equal(isUsableSupportClaim({ ...claim, checkedAt: new Date(now + 1).toISOString() }, now), false);
    assert.equal(isUsableSupportClaim({ ...claim, checkedAt: "bad" }, now), false);
    assert.equal(isUsableSupportClaim({ ...claim, purposes: ["first_email"] }, now), false);
});
