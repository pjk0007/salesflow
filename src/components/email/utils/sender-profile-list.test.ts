import { test } from "node:test";
import assert from "node:assert/strict";
import { getSenderProfilePage } from "./sender-profile-list";

const profiles = Array.from({ length: 17 }, (_, index) => ({
    id: index + 1, name: `프로필 ${index + 1}`, fromName: "김이삭",
    fromEmail: `cs@domain${index + 1}.cloud`, isDefault: index === 16,
}));

test("기본 프로필을 먼저 보여주며 원본 순서를 변경하지 않는다", () => {
    const result = getSenderProfilePage(profiles, "", 1);
    assert.deepEqual(result.items.map((item) => item.id), [17, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(result.totalPages, 3);
    assert.equal(profiles[0].id, 1);
});

test("이름, 발신 이름, 이메일을 검색하며 대소문자와 앞뒤 공백을 무시한다", () => {
    assert.equal(getSenderProfilePage(profiles, " DOMAIN12.CLOUD ", 1).total, 1);
    assert.equal(getSenderProfilePage(profiles, "프로필 12", 1).items[0].id, 12);
    assert.equal(getSenderProfilePage(profiles, "김이삭", 1).total, 17);
});

test("삭제나 검색으로 페이지 수가 줄면 마지막 유효 페이지를 보여준다", () => {
    const result = getSenderProfilePage(profiles.slice(0, 8), "", 3);
    assert.equal(result.page, 1);
    assert.equal(result.items.length, 8);
    assert.equal(getSenderProfilePage(profiles, "", 3).items.length, 1);
});

test("빈 목록과 검색 결과 없음은 빈 첫 페이지를 반환한다", () => {
    for (const result of [getSenderProfilePage([], "", 2), getSenderProfilePage(profiles, "missing", 2)]) {
        assert.deepEqual(result.items, []);
        assert.equal(result.page, 1);
        assert.equal(result.total, 0);
        assert.equal(result.totalPages, 1);
    }
});
