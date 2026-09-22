import { test } from "node:test";
import assert from "node:assert";
import { getQuotaLimitForPlanSlug } from "./quota-limits";

test("enterprise는 월 50억 토큰이다 (B1)", () => {
    assert.equal(getQuotaLimitForPlanSlug("enterprise"), 5_000_000_000);
});

test("enterprise 한도는 int4 상한을 넘는다 — bigint 컬럼이 전제다 (B1)", () => {
    assert.ok(getQuotaLimitForPlanSlug("enterprise") > 2_147_483_647);
});

test("pro는 1억으로 기존과 같다 (B2)", () => {
    assert.equal(getQuotaLimitForPlanSlug("pro"), 100_000_000);
});

test("free·미지정·미등록 slug는 1천만으로 폴백한다 (B2)", () => {
    assert.equal(getQuotaLimitForPlanSlug("free"), 10_000_000);
    assert.equal(getQuotaLimitForPlanSlug(undefined), 10_000_000);
    assert.equal(getQuotaLimitForPlanSlug(""), 10_000_000);
    assert.equal(getQuotaLimitForPlanSlug("존재하지-않는-슬러그"), 10_000_000);
});

test("표시명(name)을 넣으면 폴백된다 — slug 기준임을 고정한다 (B2)", () => {
    assert.equal(getQuotaLimitForPlanSlug("Enterprise"), 10_000_000);
});
