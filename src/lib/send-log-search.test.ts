import test from "node:test";
import assert from "node:assert/strict";
import { isExactEmailSearch } from "./send-log-search";

test("S1: 전체 이메일 주소는 대소문자·앞뒤 공백과 무관하게 정확 검색", () => {
    for (const value of ["info@inzent.com", " Info@Inzent.com ", "a+b@sub.example.com"]) {
        assert.equal(isExactEmailSearch(value), true, value);
    }
});
test("S1: 부분 주소·공백·퍼센트·빈 값은 기존 부분 검색", () => {
    for (const value of ["inzent", "@inzent.com", "info@", "a b@c.com", "a%@c.com", "", "   ", "a@b", "a@@b.com", "a@b.", "a@.com", "a@b%.com", "a\tb@c.com"]) {
        assert.equal(isExactEmailSearch(value), false, value);
    }
});
