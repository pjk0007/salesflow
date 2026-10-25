import { test } from "node:test";
import assert from "node:assert";
import {
    TRACKER_RATE_LIMITS,
    trackerRequestAllowed,
    trackerVisitorAllowed,
    trackerRateLimitedRecently,
} from "./rate-limit";

// 버킷은 모듈 메모리라 시험마다 다른 API 키를 쓴다
let seq = 0;
const freshKey = () => `test-key-${Date.now()}-${++seq}`;

test("UX-272 서로 다른 방문자 수백 명은 사이트 키 하나여도 통과한다 (예전 한도 200건/분)", () => {
    const key = freshKey();
    let rejected = 0;
    for (let v = 0; v < 300; v++) {
        for (let i = 0; i < 3; i++) {
            if (!trackerRequestAllowed("collect", key, `10.0.${Math.floor(v / 250)}.${v % 250}`)) rejected++;
            else if (!trackerVisitorAllowed("collect", key, `visitor-${v}`, i === 0 ? "PAGE_VIEW" : "HEARTBEAT")) rejected++;
        }
    }
    assert.strictEqual(rejected, 0);
    assert.strictEqual(trackerRateLimitedRecently(key).count, 0);
});

test("UX-272 한 방문자의 과다 요청은 여전히 429, 다른 방문자는 영향 없음", () => {
    const key = freshKey();
    const max = TRACKER_RATE_LIMITS.collect.visitor.maxRequests;
    for (let i = 0; i < max; i++) assert.ok(trackerVisitorAllowed("collect", key, "loud", "CLICK"));
    assert.strictEqual(trackerVisitorAllowed("collect", key, "loud", "CLICK"), false);
    assert.ok(trackerVisitorAllowed("collect", key, "quiet", "CLICK"));
    const limited = trackerRateLimitedRecently(key);
    assert.strictEqual(limited.count, 1);
    assert.ok(limited.lastAt);
});

test("UX-272 HEARTBEAT는 별도 칸 — 하트비트가 넘쳐도 페이지뷰·클릭은 막히지 않는다", () => {
    const key = freshKey();
    const hbMax = TRACKER_RATE_LIMITS.collect.heartbeat.maxRequests;
    for (let i = 0; i < hbMax; i++) assert.ok(trackerVisitorAllowed("collect", key, "v", "HEARTBEAT"));
    assert.strictEqual(trackerVisitorAllowed("collect", key, "v", "HEARTBEAT"), false);
    assert.ok(trackerVisitorAllowed("collect", key, "v", "PAGE_VIEW"));
});

test("UX-272 한 IP의 과다 요청은 DB 조회 전에 막히고, IP를 모르면 사이트 전체 한도만 본다", () => {
    const key = freshKey();
    const ipMax = TRACKER_RATE_LIMITS.collect.ip.maxRequests;
    for (let i = 0; i < ipMax; i++) assert.ok(trackerRequestAllowed("collect", key, "203.0.113.9"));
    assert.strictEqual(trackerRequestAllowed("collect", key, "203.0.113.9"), false);
    assert.ok(trackerRequestAllowed("collect", key, "203.0.113.10"));
    assert.ok(trackerRequestAllowed("collect", key, null));
});

test("UX-272 identify도 방문자별 — 한 방문자 초과 시 다른 방문자는 통과, 수집과 칸이 섞이지 않는다", () => {
    const key = freshKey();
    const max = TRACKER_RATE_LIMITS.identify.visitor.maxRequests;
    for (let i = 0; i < max; i++) assert.ok(trackerVisitorAllowed("identify", key, "v1"));
    assert.strictEqual(trackerVisitorAllowed("identify", key, "v1"), false);
    assert.ok(trackerVisitorAllowed("identify", key, "v2"));
    assert.ok(trackerVisitorAllowed("collect", key, "v1", "PAGE_VIEW"));
});

test("UX-272 막힌 횟수는 사이트(API 키)별이고 1시간이 지나면 빠진다", () => {
    const key = freshKey();
    const other = freshKey();
    const max = TRACKER_RATE_LIMITS.identify.visitor.maxRequests;
    for (let i = 0; i < max + 2; i++) trackerVisitorAllowed("identify", key, "v");
    assert.strictEqual(trackerRateLimitedRecently(key).count, 2);
    assert.strictEqual(trackerRateLimitedRecently(other).count, 0);
    assert.strictEqual(trackerRateLimitedRecently(key, Date.now() + 61 * 60 * 1000).count, 0);
});
