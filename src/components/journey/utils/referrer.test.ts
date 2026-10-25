import test from "node:test";
import assert from "node:assert/strict";
import { classifyInflow, summarizeChannelConversions } from "./referrer";
import { parseInflowDetail } from "@/components/tracker/utils/inflowDetail";
import { isolateEnv } from "@/lib/auth-fake-db.test-helper";
import { buildTrackerLabelMaps } from "@/lib/journey/tracker-label-maps";

const HOUSE = ["designer-hire.com"];
const SHOP = ["shop.example.test"];

test("UX-275 자기 사이트(허용 도메인) referrer는 직접 — 하우스 사이트는 도메인이 등록돼 있으면 기존 분류 유지", () => {
    assert.equal(classifyInflow("https://designer-hire.com/pricing", "https://designer-hire.com/signup", HOUSE), "직접");
    assert.equal(classifyInflow("https://www.designer-hire.com/", null, HOUSE), "직접", "www는 함께 허용 (수집 허용 규칙과 같다)");
});

test("UX-275 다른 고객사의 사이트 안 이동·새 탭·세션 만료 뒤 재활동은 기타가 아니라 직접", () => {
    assert.equal(classifyInflow("https://shop.example.test/products/1", "https://shop.example.test/cart", SHOP), "직접");
    // 예전에는 코드에 박힌 3개 도메인만 직접이라 이 경우 기타였다
    assert.equal(classifyInflow("https://shop.example.test/products/1", null, []), "기타", "도메인을 모르면 자기 사이트로 보지 않는다");
});

test("UX-275 교차 도메인: 하우스 도메인에서 넘어온 다른 회사 사이트 방문은 숨기지 않고 기타", () => {
    assert.equal(classifyInflow("https://designer-hire.com/blog", "https://shop.example.test/", SHOP), "기타");
    // 같은 사이트에 여러 도메인을 등록했으면(교차 도메인 연결) 서로 직접
    assert.equal(classifyInflow("https://designer-hire.com/blog", null, ["designer-hire.com", "shop.example.test"]), "직접");
});

test("UX-275 localhost 개발 환경·referrer 없음은 직접, 검색·광고·메일 우선순위는 그대로", () => {
    assert.equal(classifyInflow("http://localhost:3000/a", null, []), "직접");
    assert.equal(classifyInflow("http://127.0.0.1:5173/", null, SHOP), "직접");
    assert.equal(classifyInflow(null, "https://shop.example.test/", SHOP), "직접");
    assert.equal(classifyInflow("https://search.naver.com/search.naver?query=a", null, SHOP), "네이버 검색");
    assert.equal(classifyInflow("https://shop.example.test/", "https://shop.example.test/?gclid=x", SHOP), "구글 검색광고");
    assert.equal(classifyInflow("https://shop.example.test/", "https://shop.example.test/?sendb_cid=c1", SHOP), "메일");
    assert.equal(classifyInflow("email", null, SHOP), "메일");
    assert.equal(classifyInflow("android-app://com.x", null, SHOP), "기타", "URL이 아닌 referrer는 자기 도메인이 아니다");
});

test("UX-275 채널별 전환·유입 상세도 같은 도메인 인자를 쓴다", () => {
    const rows = [
        { visitor_id: 1, is_lead: true, referrer: "https://shop.example.test/a", landing_page: null },
        { visitor_id: 2, is_lead: false, referrer: "https://other.test/", landing_page: null },
    ];
    assert.deepEqual(summarizeChannelConversions(rows, SHOP).map((r) => [r.channel, r.visitors, r.leads]), [["기타", 1, 0], ["직접", 1, 1]]);
    assert.equal(parseInflowDetail("https://shop.example.test/a", null, SHOP).channel, "직접");
    assert.equal(parseInflowDetail("https://shop.example.test/a", null).channel, "기타");
});

test("UX-275 여정 정규화는 세션의 사이트별 허용 도메인으로 유입을 분류한다", async (t) => {
    isolateEnv(t);
    const { normalizeTrackerEvents, buildAttribution } = await import("@/lib/journey/tracker-journey");
    const at = new Date("2026-10-25T00:00:00+09:00");
    const sessions = [
        { id: 1, siteId: 7, startedAt: at, duration: 30, referrer: "https://shop.example.test/x", landingPage: "https://shop.example.test/y" },
        { id: 2, siteId: 8, startedAt: new Date(at.getTime() + 60_000), duration: 30, referrer: "https://shop.example.test/x", landingPage: "https://b.test/" },
    ];
    const maps = { ...buildTrackerLabelMaps([], []), siteDomains: new Map([[7, SHOP], [8, ["b.test"]]]) };
    const events = normalizeTrackerEvents(sessions as Parameters<typeof normalizeTrackerEvents>[0], [], maps);
    const visits = events.filter((e) => e.type === "session").sort((a, b) => a.at.localeCompare(b.at));
    assert.deepEqual(visits.map((v) => v.meta.inflowChannel), ["직접", "기타"]);
    assert.deepEqual(buildAttribution(visits, null).path.map((p) => p.channel), ["직접", "기타"]);
});
