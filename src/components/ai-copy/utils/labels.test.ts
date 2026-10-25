import test from "node:test";
import assert from "node:assert/strict";
import { plainTextFromHtml, reasonLabel, resultLabel } from "./labels";

test("UX-241 시도 결과는 한국어, 미등록 사유는 '기타 사유', 한국어 사유는 그대로", () => {
    assert.deepEqual(
        ["valid", "validation_failed", "provider_failed", "timeout", "running", "late", "x"].map(resultLabel),
        ["통과", "형식·검증 실패", "AI 호출 실패", "시간 초과", "진행 중", "늦은 응답", "기타 결과"],
    );
    assert.equal(reasonLabel("worker_lease_expired"), "작업 처리 중단(결과 미확인)");
    assert.equal(reasonLabel("provider_http_529"), "AI 공급자 오류(HTTP 529)");
    assert.equal(reasonLabel("blocked_version: 사실과 다른 가격"), "차단된 버전: 사실과 다른 가격");
    assert.equal(reasonLabel("관리자 취소"), "관리자 취소");
    assert.equal(reasonLabel("some_new_code"), "기타 사유");
    assert.equal(reasonLabel(null), "—");
});

test("UX-241 본문은 태그를 걷고 줄바꿈과 엔티티를 살린다", () => {
    assert.equal(
        plainTextFromHtml("<p>안녕하세요 &amp; 반갑습니다</p><p>둘째 줄<br>셋째 &quot;줄&quot;</p>"),
        '안녕하세요 & 반갑습니다\n둘째 줄\n셋째 "줄"',
    );
    assert.equal(plainTextFromHtml("&amp;lt;"), "&lt;", "이중 이스케이프는 한 번만 복원");
});
