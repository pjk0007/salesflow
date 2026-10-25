import test from "node:test";
import assert from "node:assert/strict";
import { groupAdSessions } from "./ad-group";
import { classifyInflow, matchesChannelFilter } from "./referrer";

// UX-203 — 마케팅 탭 광고 성과 표가 개요와 같은 채널·광고/자연 조건을 따르는지 확인한다.
const SESSIONS = [
    { visitorId: 1, referrer: null, landingPage: "https://a.test/?gclid=x&utm_source=google&utm_medium=cpc&utm_term=crm" },
    { visitorId: 1, referrer: null, landingPage: "https://a.test/?gclid=y&utm_source=google&utm_medium=cpc&utm_term=crm" },
    { visitorId: 2, referrer: null, landingPage: "https://a.test/?fbclid=z&utm_campaign=c1&utm_content=s1&utm_term=111" },
    { visitorId: 3, referrer: null, landingPage: "https://a.test/?utm_source=naver&utm_medium=cpc&utm_term=영업" },
    { visitorId: 4, referrer: "https://search.naver.com/search.naver?query=x", landingPage: "https://a.test/" },
    { visitorId: 5, referrer: null, landingPage: "https://a.test/" },
    { visitorId: null, referrer: null, landingPage: "https://a.test/?gclid=q" },
];

const visitorsOf = (r: ReturnType<typeof groupAdSessions>) =>
    [...r.visitorsByGroup.values()].flatMap((s) => [...s]).sort();

test("전체 조건 — 광고 세션만 광고 그룹으로 묶고 같은 방문자는 한 번만 센다", () => {
    const r = groupAdSessions(SESSIONS, null, "all");
    assert.deepEqual([...r.groups.keys()].sort(), ["google|search|crm", "meta|c1|s1|111", "naver||영업"]);
    assert.equal(r.visitorsByGroup.get("google|search|crm")?.size, 1);
    assert.deepEqual(visitorsOf(r), [1, 2, 3]);
});

test("자연만 — 광고 그룹이 하나도 남지 않는다", () => {
    assert.equal(groupAdSessions(SESSIONS, null, "organic").groups.size, 0);
});

test("채널·광고만 — 선택한 상위 채널의 광고만 남는다", () => {
    assert.deepEqual(visitorsOf(groupAdSessions(SESSIONS, "구글", "paid")), [1]);
    assert.deepEqual(visitorsOf(groupAdSessions(SESSIONS, "네이버", "all")), [3]);
    assert.deepEqual(visitorsOf(groupAdSessions(SESSIONS, "메타 광고", "all")), [2]);
    assert.equal(groupAdSessions(SESSIONS, "직접", "all").groups.size, 0);
});

test("개요 세션 필터와 같은 판정 — 표에 들어온 방문자는 모두 개요 필터도 통과한다", () => {
    for (const channel of [null, "구글", "네이버", "메타 광고", "직접", "기타"]) {
        for (const mode of ["all", "paid", "organic"] as const) {
            const overviewVisitors = new Set(SESSIONS
                .filter((s) => s.visitorId != null && matchesChannelFilter(classifyInflow(s.referrer, s.landingPage), channel, mode))
                .map((s) => s.visitorId));
            for (const v of visitorsOf(groupAdSessions(SESSIONS, channel, mode))) {
                assert.ok(overviewVisitors.has(v), `${channel}/${mode} 방문자 ${v}`);
            }
        }
    }
});
