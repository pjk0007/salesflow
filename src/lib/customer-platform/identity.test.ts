import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { issueCustomerIdentity, verifyCustomerIdentity } from "./identity";
import { canAccessWorkspace } from "./rules";
test("회원 상담 인증은 만료·채널 경계를 검증하고 직원 JWT로 사용할 수 없다", () => {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "customer-platform-test-only";
    try {
        const id = "00000000-0000-4000-8000-000000000001",
            key = "a".repeat(48),
            now = new Date("2026-10-14T00:00:00Z");
        const result = issueCustomerIdentity(id, key, now);
        assert.equal(
            verifyCustomerIdentity(result.identityToken, key, now),
            id,
        );
        assert.throws(() =>
            verifyCustomerIdentity(result.identityToken, "b".repeat(48), now),
        );
        assert.throws(() =>
            verifyCustomerIdentity(
                result.identityToken,
                key,
                new Date(now.getTime() + 901000),
            ),
        );
        assert.throws(() =>
            jwt.verify(result.identityToken, process.env.JWT_SECRET!),
        );
        const staff = jwt.sign(
            { userId: id, role: "admin" },
            process.env.JWT_SECRET!,
        );
        assert.throws(() => verifyCustomerIdentity(staff, key, now));
    } finally {
        if (previous === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previous;
    }
});
test("서비스 API의 고객 플랫폼 권한은 조직 또는 정확한 사업 범위에만 적용", () => {
    const permissions = {
        read: true,
        create: false,
        update: false,
        delete: false,
    };
    assert.ok(
        canAccessWorkspace(
            [{ scopeType: "workspace", scopeId: 8, permissions }],
            8,
            "read",
        ),
    );
    assert.ok(
        !canAccessWorkspace(
            [{ scopeType: "workspace", scopeId: 8, permissions }],
            10,
            "read",
        ),
    );
    assert.ok(
        !canAccessWorkspace(
            [{ scopeType: "workspace", scopeId: 8, permissions }],
            8,
            "create",
        ),
    );
    assert.ok(
        !canAccessWorkspace(
            [{ scopeType: "folder", scopeId: 8, permissions }],
            8,
            "read",
        ),
    );
    assert.ok(
        canAccessWorkspace(
            [{ scopeType: "org", scopeId: 0, permissions }],
            10,
            "read",
        ),
    );
});
