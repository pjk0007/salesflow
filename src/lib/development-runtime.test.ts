import assert from "node:assert/strict";
import test from "node:test";
import { isDevelopmentPreviewRuntime } from "./development-runtime";

test("development host disables background workers even with production Node runtime", () => {
    assert.equal(isDevelopmentPreviewRuntime({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app/",
    }), true);
});

test("production and other services keep their existing worker configuration", () => {
    for (const url of ["https://sendb.kr", "https://www.sendb.kr", "https://example.test", "http://localhost:3000"])
        assert.equal(isDevelopmentPreviewRuntime({ NEXT_PUBLIC_APP_URL: url }), false);
});

test("missing, invalid, or lookalike origins do not match the development service", () => {
    for (const url of [undefined, "invalid", "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app.example.test", "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app:444"])
        assert.equal(isDevelopmentPreviewRuntime({ NEXT_PUBLIC_APP_URL: url }), false);
});
