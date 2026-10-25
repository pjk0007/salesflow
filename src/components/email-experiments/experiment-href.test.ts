import test from "node:test";
import assert from "node:assert/strict";
import { experimentHref } from "./experiment-href";

test("UX-242 실험 주소는 tab·experimentId를 정하고 다른 값은 남긴다", () => {
    assert.equal(experimentHref(9921), "/email?tab=experiments&experimentId=9921");
    // 화면 안에서 다른 실험을 고르면 이전 번호를 바꾼다 — 새로고침해도 고른 실험이 열린다
    assert.equal(experimentHref(9921, "tab=experiments&experimentId=9922"), "/email?tab=experiments&experimentId=9921");
    assert.equal(experimentHref(5, new URLSearchParams("tab=experiments&ruleId=3")), "/email?tab=experiments&ruleId=3&experimentId=5");
});
