import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyName } from "./company-name";

test("법인 표기를 제거해 같은 회사로 묶는다", () => {
    assert.equal(normalizeCompanyName("(주)세명기업"), "세명기업");
    assert.equal(normalizeCompanyName("㈜세명기업"), "세명기업");
    assert.equal(normalizeCompanyName("주식회사 세명기업"), "세명기업");
    assert.equal(normalizeCompanyName("세명기업"), "세명기업");
});

test("대소문자와 공백 차이를 무시한다", () => {
    assert.equal(normalizeCompanyName("AhnLab"), normalizeCompanyName("ahnlab"));
    assert.equal(normalizeCompanyName("Ahn Lab"), normalizeCompanyName("AhnLab"));
    assert.equal(normalizeCompanyName("  AhnLab  "), "ahnlab");
});

test("서로 다른 회사는 구분한다", () => {
    assert.notEqual(normalizeCompanyName("세명기업"), normalizeCompanyName("세명산업"));
});

test("빈 값이면 빈 문자열 — 호출부가 조회를 건너뛴다", () => {
    assert.equal(normalizeCompanyName(""), "");
    assert.equal(normalizeCompanyName("   "), "");
    assert.equal(normalizeCompanyName("(주)"), "");
});

test("SQL 인덱스 표현식과 동일한 결과를 낸다", () => {
    // drizzle/0068_company_research_cache_idx.sql의 regexp_replace와 규칙이 어긋나면
    // 인덱스를 타지 못해 캐시 미스마다 풀스캔(17초)이 된다.
    const cases = ["(유)한국물산", "유한회사 한국물산", "한국 물산"];
    assert.equal(normalizeCompanyName(cases[0]), "한국물산");
    assert.equal(normalizeCompanyName(cases[1]), "한국물산");
    assert.equal(normalizeCompanyName(cases[2]), "한국물산");
});
