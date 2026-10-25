import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { middleware, config } from "../../middleware";

test("Next matcher는 체험 페이지·정적 자료·evidence와 기존v1에 적용된다", () => {
    for (const url of ["/dev-start", "/dev-start/", "/dev-start/start.js", "/dev-start/guide/evidence.json", "/dev-start/esign-contract.pdf", "/api/v1/records"]) {
        assert.equal(unstable_doesMiddlewareMatch({ config, url }), true);
    }
    for (const url of ["/", "/login", "/dev-starter", "/api/workspaces"]) {
        assert.equal(unstable_doesMiddlewareMatch({ config, url }), false);
    }
});

test("운영·누락·유사 개발 주소에서는 개발 체험 경로와 evidence를 404로 막는다", () => {
    const before = process.env.NEXT_PUBLIC_APP_URL;
    try {
        for (const url of ["https://sendb.kr", "", "invalid", "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app.example.test"]) {
            process.env.NEXT_PUBLIC_APP_URL = url;
            for (const path of ["/dev-start", "/dev-start/", "/dev-start/start.js", "/dev-start/guide/evidence.json", "/dev-start/esign-contract.pdf"]) {
                for (const method of ["GET", "HEAD", "OPTIONS"]) {
                    const response = middleware(new NextRequest(`https://sendb.kr${path}`, { method }));
                    assert.equal(response.status, 404);
                    assert.equal(response.headers.get("cache-control"), "no-store");
                    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
                    assert.equal(response.headers.get("x-middleware-next"), null);
                }
            }
        }
    } finally {
        if (before === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
        else process.env.NEXT_PUBLIC_APP_URL = before;
    }
});

test("지정 개발 서비스의 체험 흐름과 v1 CORS 계약은 유지한다", () => {
    const before = process.env.NEXT_PUBLIC_APP_URL;
    try {
        process.env.NEXT_PUBLIC_APP_URL = "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app/";
        const preview = middleware(new NextRequest("https://example.test/dev-start/guide/evidence.json"));
        assert.equal(preview.headers.get("x-middleware-next"), "1");
        const preflight = middleware(new NextRequest("https://example.test/api/v1/records", { method: "OPTIONS" }));
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
        assert.equal(middleware(new NextRequest("https://example.test/api/v1/records")).headers.get("access-control-allow-origin"), "*");
    } finally {
        if (before === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
        else process.env.NEXT_PUBLIC_APP_URL = before;
    }
});
