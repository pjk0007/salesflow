import { test } from "node:test";
import assert from "node:assert";
import { parseAttributionParams, cleanCampaignValue } from "./parse-params";

// ── parseAttributionParams ──

test("파라미터가 없으면 빈 객체", () => {
    assert.deepEqual(parseAttributionParams(""), {});
    assert.deepEqual(parseAttributionParams("?"), {});
});

test("sendb_cid와 utm을 수집한다", () => {
    const r = parseAttributionParams("?sendb_cid=clk_abc123&utm_campaign=job-platform");
    assert.equal(r.clickId, "clk_abc123");
    assert.equal(r.utmCampaign, "job-platform");
});

test("clk_ 접두사가 없는 sendb_cid는 무시한다", () => {
    // 임의 값 주입 방지 — 발급 토큰만 신뢰
    assert.equal(parseAttributionParams("?sendb_cid=evil").clickId, undefined);
    assert.equal(parseAttributionParams("?sendb_cid=12345").clickId, undefined);
});

test("화이트리스트 밖 파라미터는 무시한다", () => {
    // 임베드 스니펫이 부모 location.search를 통째로 넘기므로 필수
    const r = parseAttributionParams("?sendb_cid=clk_a&sessionToken=secret&foo=bar");
    assert.deepEqual(Object.keys(r).sort(), ["clickId"]);
});

test("빈 문자열은 미설정과 같다", () => {
    assert.deepEqual(parseAttributionParams("?utm_campaign=&sendb_cid="), {});
});

test("200자를 넘는 값은 잘라낸다", () => {
    // DB 컬럼이 varchar(200)
    const long = "a".repeat(250);
    assert.equal(parseAttributionParams(`?utm_campaign=${long}`).utmCampaign?.length, 200);
});

test("? 없이 시작해도 파싱한다", () => {
    assert.equal(parseAttributionParams("utm_campaign=outreach").utmCampaign, "outreach");
});

test("중복 ?가 있어도 뒤쪽 파라미터를 잡는다", () => {
    // 실측: https://...?utm_source=email&utm_campaign=outreach?utm_source=owned&utm_campaign=youtuber
    const r = parseAttributionParams("?utm_campaign=outreach?utm_source=owned&utm_medium=ai-email");
    assert.equal(r.utmMedium, "ai-email");
});

// ── cleanCampaignValue ──

test("후행 괄호·대괄호·슬래시를 제거한다", () => {
    // 실측 오염값: AI가 마크다운 링크를 쓰며 ) ] 가 딸려 들어감
    assert.equal(cleanCampaignValue("outreach)"), "outreach");
    assert.equal(cleanCampaignValue("outreach]"), "outreach");
    assert.equal(cleanCampaignValue("outreach/"), "outreach");
    assert.equal(cleanCampaignValue("outreach))"), "outreach");
});

test("정상 값은 그대로 둔다", () => {
    assert.equal(cleanCampaignValue("job-platform-followup-d3"), "job-platform-followup-d3");
    assert.equal(cleanCampaignValue("t2-pain"), "t2-pain");
});

test("한글이 붙은 오염값도 잘라낸다", () => {
    // 실측: outreach)를, outreach]디자이너하이어
    assert.equal(cleanCampaignValue("outreach)를"), "outreach");
    assert.equal(cleanCampaignValue("outreach]디자이너하이어"), "outreach");
});

test("URL이 통째로 딸려온 경우도 잘라낸다", () => {
    // 실측: outreach](https://designer-hire.com
    assert.equal(cleanCampaignValue("outreach](https://designer-hire.com"), "outreach");
});

test("빈 값이면 undefined", () => {
    assert.equal(cleanCampaignValue(""), undefined);
    assert.equal(cleanCampaignValue(")"), undefined);
});
