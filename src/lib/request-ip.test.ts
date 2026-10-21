import test from "node:test";
import assert from "node:assert/strict";
import { requestIp } from "./request-ip";

test("XFF 첫 IP를 우선하고 유효하지 않으면 real IP로 대체", () => {
    const cases: [Record<string, string>, string | null][] = [
        [{ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }, "203.0.113.7"],
        [{ "x-forwarded-for": " 2001:db8::1 " }, "2001:db8::1"],
        [{ "x-real-ip": "198.51.100.2" }, "198.51.100.2"],
        [{ "x-forwarded-for": "<b>", "x-real-ip": "198.51.100.2" }, "198.51.100.2"],
        [{ "x-forwarded-for": "a".repeat(46) }, null], [{}, null],
    ];
    for (const [headers, expected] of cases) assert.equal(requestIp(new Headers(headers)), expected);
});
