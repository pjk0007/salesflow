import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

test("프록시 배포의 직원·고객 요청은 설정한 공개 출처만 허용한다", async () => {
    // 실제 DB·인증값을 사용하지 않으며 DB 질의를 실행하지 않는다.
    const before = {
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    };
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
    process.env.JWT_SECRET = "proxy-origin-test-only-not-a-real-secret";
    const app = "https://preview.example.test";
    process.env.NEXT_PUBLIC_APP_URL = app;
    const { inboxActor, publicGuard } = await import("./http");
    const { generateToken } = await import("../auth");
    const { queryClient } = await import("../db");
    try {
        const actor = {
            userId: "00000000-0000-4000-8000-000000000001",
            orgId: "00000000-0000-4000-8000-000000000002",
            email: "test@example.test",
            name: "가상 직원",
            role: "admin" as const,
        };
        const token = generateToken(actor);
        const request = (origin: string, authenticated = true) =>
            new NextRequest("http://0.0.0.0:3000/api/inbox/channels", {
                method: "POST",
                headers: {
                    origin,
                    // 요청자가 보낸 전달 헤더는 출처 허용의 근거가 아니다.
                    "x-forwarded-host": "attacker.example.test",
                    "x-forwarded-proto": "https",
                    ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
                },
            });
        const key = "a".repeat(48);
        assert.equal(inboxActor(request(app)).userId, actor.userId);
        assert.doesNotThrow(() => publicGuard(request(app, false), key));
        assert.throws(() => inboxActor(request(app, false)), /인증이 필요/);
        for (const origin of [
            "https://attacker.example.test",
            "http://0.0.0.0:3000",
            "http://preview.example.test",
            "https://preview.example.test:444",
        ]) {
            assert.throws(() => inboxActor(request(origin)), /허용되지 않은/);
            assert.throws(() => publicGuard(request(origin, false), key), /상담창에서/);
        }
        process.env.NEXT_PUBLIC_APP_URL = "invalid";
        assert.throws(() => inboxActor(request(app)), /허용되지 않은/);
    } finally {
        await queryClient.end();
        for (const [key, value] of Object.entries(before)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
