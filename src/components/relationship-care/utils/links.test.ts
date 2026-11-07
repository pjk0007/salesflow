import assert from "node:assert/strict";
import { test } from "node:test";
import { lastTouchText, mailtoLink, seoulToday, smsLink } from "./links";
test("메일·문자 앱 링크는 초안을 인코딩하고 전화번호는 숫자만 남긴다", () => {
    assert.equal(
        mailtoLink("kim@ex.com", "안부", "줄1\n줄2 & 끝"),
        "mailto:kim%40ex.com?subject=%EC%95%88%EB%B6%80&body=%EC%A4%841%0A%EC%A4%842%20%26%20%EB%81%9D",
    );
    assert.equal(smsLink("010-1234-5678", "안녕"), "sms:01012345678?body=%EC%95%88%EB%85%95");
});
test("마지막 연락 문구와 서울 날짜", () => {
    assert.equal(lastTouchText(null), "아직 연락 기록 없음");
    assert.equal(lastTouchText(0), "오늘 연락함");
    assert.equal(lastTouchText(74), "마지막 연락 74일 전");
    assert.equal(seoulToday(new Date("2026-11-07T16:00:00Z")), "2026-11-08");
});
