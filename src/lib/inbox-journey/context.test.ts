import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { issueJourneyContext, verifyJourneyContext } from "./context";
test("방문 경로 증명은 만료·변조·직원/회원 토큰 재사용을 거부한다", () => {
    const old = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "fictional-journey-test-secret";
    try {
        const now = new Date("2026-10-15T10:00:00Z");
        const value = { orgId: "00000000-0000-4000-8000-000000000001", workspaceId: 8,
            siteId: 1, visitorId: 2, sessionId: 3, origin: "https://example.test" };
        const token = issueJourneyContext(value, now)!;
        assert.equal(verifyJourneyContext(token, now).sessionId, 3);
        assert.throws(() => verifyJourneyContext(token, new Date(now.getTime() + 1800001)));
        assert.throws(() => verifyJourneyContext(token.slice(0, -8) + "modified", now));
        assert.throws(() => verifyJourneyContext(jwt.sign({ ...value, kind: "sendb-customer" }, process.env.JWT_SECRET!), now));
        delete process.env.JWT_SECRET;
        assert.equal(issueJourneyContext(value, now), undefined);
    } finally {
        if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old;
    }
});
