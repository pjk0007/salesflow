import { test, afterEach } from "node:test";
import assert from "node:assert";
import { lookupDomainMx, lookupEmailMx, setMxResolverForTests } from "./email-mx-lookup";

// DESIGN-3 2·3절 — MX 조회: 짧은 시간 제한, 도메인마다 캐시, 저장·발송을 막지 않는다 (던지지 않음).
// 실제 DNS로 나가지 않는다 — 조회 함수를 바꿔 끼운다 (파일을 읽자마자, 그리고 시험마다)

const noRealDns = () => Promise.reject(Object.assign(new Error("실제 DNS 금지"), { code: "ETEST" }));
setMxResolverForTests(noRealDns);

afterEach(() => {
    setMxResolverForTests(noRealDns);
    delete process.env.EMAIL_MX_LOOKUP;
});

function fakeDns(table: Record<string, Array<{ exchange: string; priority: number }> | string>) {
    const calls: string[] = [];
    setMxResolverForTests(async (domain) => {
        calls.push(domain);
        const v = table[domain];
        if (typeof v === "string") throw Object.assign(new Error(v), { code: v });
        if (!v) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
        return v;
    });
    return calls;
}

test("MX가 있으면 ok, 없으면 none, DNS 일시 오류는 unknown — 던지지 않는다", async () => {
    fakeDns({
        "matchesplan.com": [{ exchange: "aspmx.l.google.com", priority: 1 }],
        "matchesplan.me": "ENODATA",
        "flaky.kr": "ESERVFAIL",
    });
    assert.equal(await lookupDomainMx("matchesplan.com"), "ok");
    assert.equal(await lookupDomainMx("matchesplan.me"), "none");
    assert.equal(await lookupDomainMx("nothing-here.kr"), "none");
    assert.equal(await lookupDomainMx("flaky.kr"), "unknown");
});

test("도메인마다 캐시한다 (대소문자·끝 점 무시), 동시에 물어도 한 번만 조회", async () => {
    const calls = fakeDns({ "matchesplan.com": [{ exchange: "mx.x.com", priority: 1 }] });
    const got = await Promise.all([
        lookupDomainMx("matchesplan.com"),
        lookupDomainMx("MatchesPlan.com"),
        lookupDomainMx("matchesplan.com."),
    ]);
    assert.deepEqual(got, ["ok", "ok", "ok"]);
    assert.equal(await lookupDomainMx("matchesplan.com"), "ok");
    assert.deepEqual(calls, ["matchesplan.com"]);
});

test("캐시 기간: ok는 하루 안에 다시 묻지 않고, 하루가 지나면 다시 묻는다", async () => {
    const calls = fakeDns({ "biz.kr": [{ exchange: "mx.biz.kr", priority: 1 }] });
    let now = 1_000_000;
    assert.equal(await lookupDomainMx("biz.kr", { now: () => now }), "ok");
    now += 23 * 3600_000;
    assert.equal(await lookupDomainMx("biz.kr", { now: () => now }), "ok");
    assert.equal(calls.length, 1);
    now += 2 * 3600_000;
    assert.equal(await lookupDomainMx("biz.kr", { now: () => now }), "ok");
    assert.equal(calls.length, 2);
});

test("none은 10분만 캐시한다 — 안내대로 MX를 연결하면 10분 안에 ok로 바뀐다 (REVIEW-4 F1)", async () => {
    let hasMx = false;
    const calls: string[] = [];
    setMxResolverForTests(async (d) => {
        calls.push(d);
        if (!hasMx) throw Object.assign(new Error("x"), { code: "ENODATA" });
        return [{ exchange: "aspmx.l.google.com", priority: 1 }];
    });
    let now = 7_000_000;
    assert.equal(await lookupDomainMx("matchesplan.me", { now: () => now }), "none");
    hasMx = true; // 운영자가 MX를 연결했다
    now += 9 * 60_000;
    assert.equal(await lookupDomainMx("matchesplan.me", { now: () => now }), "none");
    assert.equal(calls.length, 1);
    now += 2 * 60_000;
    assert.equal(await lookupDomainMx("matchesplan.me", { now: () => now }), "ok");
    assert.equal(calls.length, 2);
    // ok는 다시 하루 캐시
    now += 23 * 3600_000;
    assert.equal(await lookupDomainMx("matchesplan.me", { now: () => now }), "ok");
    assert.equal(calls.length, 2);
});

test("unknown은 10분만 캐시한다 (일시 오류가 하루 내내 남지 않게)", async () => {
    let answer: "fail" | "ok" = "fail";
    const calls: string[] = [];
    setMxResolverForTests(async (d) => {
        calls.push(d);
        if (answer === "fail") throw Object.assign(new Error("x"), { code: "ETIMEOUT" });
        return [{ exchange: "mx.biz.kr", priority: 1 }];
    });
    let now = 5_000_000;
    assert.equal(await lookupDomainMx("biz.kr", { now: () => now }), "unknown");
    answer = "ok";
    now += 5 * 60_000;
    assert.equal(await lookupDomainMx("biz.kr", { now: () => now }), "unknown");
    now += 6 * 60_000;
    assert.equal(await lookupDomainMx("biz.kr", { now: () => now }), "ok");
    assert.equal(calls.length, 2);
});

test("시간 제한을 넘기면 unknown (기다리지 않는다)", async () => {
    setMxResolverForTests(() => new Promise(() => { /* 영영 답하지 않음 */ }));
    const started = Date.now();
    assert.equal(await lookupDomainMx("slow.kr", { timeoutMs: 30 }), "unknown");
    assert.ok(Date.now() - started < 2000);
});

test("예약 도메인(.test 등)은 조회하지 않고 none — 시험 환경이 바깥 DNS로 나가지 않는다", async () => {
    const calls = fakeDns({});
    assert.equal(await lookupDomainMx("dh-mail1.test"), "none");
    assert.equal(await lookupDomainMx("example.com"), "none");
    assert.equal(await lookupEmailMx("reply@biz.test"), "none");
    assert.deepEqual(calls, []);
});

test("EMAIL_MX_LOOKUP=off 이면 조회하지 않고 unknown", async () => {
    const calls = fakeDns({ "matchesplan.com": [{ exchange: "mx", priority: 1 }] });
    process.env.EMAIL_MX_LOOKUP = "off";
    assert.equal(await lookupDomainMx("matchesplan.com"), "unknown");
    assert.deepEqual(calls, []);
});

test("주소가 없거나 형식이 아니면 null·unknown, 조회하지 않음", async () => {
    const calls = fakeDns({});
    assert.equal(await lookupEmailMx(null), null);
    assert.equal(await lookupEmailMx(""), null);
    assert.equal(await lookupEmailMx("no-at"), null);
    assert.equal(await lookupDomainMx("localhostish"), "unknown");
    assert.deepEqual(calls, []);
});
