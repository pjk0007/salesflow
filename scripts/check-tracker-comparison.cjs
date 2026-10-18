/* eslint-disable @typescript-eslint/no-require-imports -- 실제 route를 가상 집계로 검수. DB·외부 발송 없음. */
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const { join } = require("node:path");
const { mkdirSync } = require("node:fs");

async function main() {
    const output = join(__dirname, "../.testenv/tracker-comparison-route.cjs");
    mkdirSync(join(__dirname, "../.testenv"), { recursive: true });
    const state = { aggregates: [], channels: [], queries: [], user: { orgId: 1 }, sites: [{ id: 8, orgId: 1, excludePaths: ["/internal"], conversionStage: null }] };
    // DB 모듈은 읽지 않는다. SQL 필터와 route 본체는 실제 코드를 사용한다.
    await build({
        entryPoints: [join(__dirname, "../src/app/api/tracker/analytics/overview/route.ts")],
        outfile: output, bundle: true, platform: "node", format: "cjs", packages: "external",
        plugins: [{ name: "isolated-fixtures", setup(builder) {
            const stubs = {
                "@/lib/db": `export const trackerSites={id:1,orgId:2}; export const db={select:()=>({from:()=>({where:async()=>global.__trackerComparison.sites})}),execute:async(query)=>{global.__trackerComparison.queries.push(query);return []}};`,
                "@/lib/auth": `export const getUserFromNextRequest=()=>global.__trackerComparison.user;`,
                "@/lib/tracker/session-filter": `export async function getSessionIdsByChannel(args){global.__trackerComparison.channels.push(args);return [global.__trackerComparison.channels.length]}`,
                "@/lib/tracker/analytics-queries": `import {sql} from 'drizzle-orm'; export const notExcludedExpr=()=>sql\`TRUE\`; export async function aggregateRange(args){const s=global.__trackerComparison;s.aggregates.push(args);return s.aggregates.length%2===1 ? {visitors:140,sessions:280,pageviews:420,avgDwell:120,bounces:140,leads:28,signups:14} : {visitors:140,sessions:140,pageviews:280,avgDwell:60,bounces:35,leads:14,signups:7};}`,
            };
            builder.onResolve({ filter: /^@\/lib\/(db|auth|tracker\/session-filter|tracker\/analytics-queries)$/ }, args => ({ path: args.path, namespace: "fixture" }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js", resolveDir: join(__dirname, "..") }));
        } }],
    });
    global.__trackerComparison = state;
    const { NextRequest } = require("next/server");
    const { GET } = require(output);
    let checks = 0;
    const request = async (query, status = 200) => {
        state.aggregates = []; state.channels = []; state.queries = [];
        const response = await GET(new NextRequest("http://qa.example.test/api/tracker/analytics/overview?siteId=8&from=2026-10-05&to=2026-10-11" + query));
        const body = await response.json();
        assert.equal(response.status, status, JSON.stringify(body));
        return body;
    };
    const custom = await request("&compareFrom=2026-09-01&compareTo=2026-09-14&device=mobile&channel=메일&channelMode=paid");
    assert.equal(custom.data.kpi.visitors.deltaPct, 100);
    assert.equal(custom.data.comparison.days, 14);
    assert.equal(custom.data.comparison.countBasis, "dailyAverage");
    assert.equal(state.aggregates[0].fromIso, "2026-10-05T00:00:00+09:00");
    assert.equal(state.aggregates[1].fromIso, "2026-09-01T00:00:00+09:00");
    assert.equal(state.aggregates[1].toIso, "2026-09-14T23:59:59.999+09:00");
    for (let index = 0; index < 2; index++) {
        assert.equal(state.aggregates[index].siteId, 8);
        assert.equal(state.aggregates[index].device, "mobile");
        assert.deepEqual(state.aggregates[index].excludes, ["/internal"]);
        assert.deepEqual(state.aggregates[index].sessionIds, [index + 1]);
        assert.equal(state.channels[index].channel, "메일");
        assert.equal(state.channels[index].channelMode, "paid");
        assert.equal(state.channels[index].fromIso, state.aggregates[index].fromIso);
    }
    console.log("PASS", ++checks, "사용자 비교 날짜·양쪽 일평균·KST 경계·동일 사이트/디바이스/채널/제외 필터");
    const automatic = await request("");
    assert.equal(automatic.data.comparison.from, "2026-09-28");
    assert.equal(automatic.data.comparison.to, "2026-10-04");
    assert.equal(automatic.data.kpi.visitors.deltaPct, 0);
    console.log("PASS", ++checks, "기존 호출은 직전 동일 기간으로 호환");
    for (const invalid of ["&compareFrom=2026-09-01", "&compareTo=2026-09-14", "&compareFrom=2026-02-30&compareTo=2026-03-01", "&compareFrom=2026-10-11&compareTo=2026-10-05", "&compareFrom=&compareTo=", "&compareFrom=9999-01-01&compareTo=9999-01-02"]) {
        await request(invalid, 400);
        assert.equal(state.aggregates.length, 0);
        assert.equal(state.channels.length, 0);
    }
    console.log("PASS", ++checks, "잘못된 비교 날짜 6종은 집계 전에 400 응답");
    state.user = null;
    await request("", 401);
    assert.equal(state.aggregates.length, 0);
    state.user = { orgId: 1 }; state.sites = [];
    await request("", 404);
    assert.equal(state.aggregates.length, 0);
    console.log("PASS", ++checks, "인증·조직별 사이트 격리 유지");
    const uiOutput = join(__dirname, "../.testenv/tracker-comparison-cards.cjs");
    await build({ entryPoints: [join(__dirname, "../src/components/tracker/ui/widgets/KpiCards.tsx")], outfile: uiOutput,
        bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic" });
    const { createElement } = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const { KpiCards } = require(uiOutput);
    for (const [delta, color, direction] of [[10, "text-rose-600", "상승"], [-10, "text-emerald-600", "하락"], [0, null, null], [null, null, null]]) {
        const html = renderToStaticMarkup(createElement(KpiCards, { comparison: custom.data.comparison,
            kpi: { ...custom.data.kpi, bounceRate: { ...custom.data.kpi.bounceRate, deltaPct: delta } } }));
        const bounce = html.split('aria-label="이탈률 지표"')[1].split('aria-label="리드 지표"')[0];
        assert.ok(!html.includes("바운스율"));
        assert.ok(bounce.includes("2026-09-01 ~ 2026-09-14 대비"));
        if (color) assert.ok(bounce.includes(color));
        else assert.ok(!bounce.includes("text-rose-600") && !bounce.includes("text-emerald-600"));
        if (direction) assert.ok(bounce.includes(`aria-label="${direction}"`));
        assert.ok(html.includes("일평균 20.0 · 비교 10.0"));
    }
    console.log("PASS", ++checks, "실제 카드 렌더링: 이탈률 명칭·상승 빨강·하락 초록·0/계산불가 중립·비교 날짜·양쪽 일평균");
    delete global.__trackerComparison;
    console.log(`트래커 API 통합 검수 ${checks}개 통과 · DB 접근/외부 발송 없음`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
