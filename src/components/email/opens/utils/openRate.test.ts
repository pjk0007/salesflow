import test from "node:test";
import assert from "node:assert/strict";
import { openRatePercent, openRateText, openRatioText, openCountText, OPEN_NOTICE_LINES } from "./openRate";

test("B21·B30: 대상 0은 null·대시, 나머지는 소수 첫째 자리", () => {
    for (const [opened, base, expected] of [[0, 0, null], [1, 3, 33.3], [2, 2, 100], [0, 5, 0]] as const) {
        assert.equal(openRatePercent(opened, base), expected);
    }
    assert.equal(openRateText(null), "—");
    assert.equal(openRateText(12.3), "12.3%");
    assert.equal(openRatioText(3, 6), "3/6");
    assert.equal(openRatioText(0, 0), undefined);
    assert.equal(openCountText(3, 0), "—");
    assert.equal(openCountText(3, 6), "3");
});
test("B31: 안내 4줄에 추정치와 누락·프리페치 한계 명시", () => {
    assert.ok(OPEN_NOTICE_LINES.length <= 4);
    for (const keyword of ["추정", "60초", "검사기", "링크", "이미지", "Apple"]) {
        assert.ok(OPEN_NOTICE_LINES.join(" ").includes(keyword));
    }
});
