import test from "node:test";
import assert from "node:assert/strict";
import { deliveryReason } from "./delivery-reason";
import { jobReasonLabel, retryableFailures } from "./job-reasons";
test("UX-125·136 메일함 변경·권한 회수·수신거부 취소는 경고색·사유·다시 넣기를 제공한다", () => {
    for (const errorCode of ["mailbox_changed", "access_revoked", "email_unsubscribed"]) {
        const r = deliveryReason({ state: "cancelled", errorCode });
        assert.equal(r.warn, true, errorCode);
        assert.ok(r.text && r.text.length > 10, errorCode);
        assert.equal(r.canRewrite, true);
    }
    const userCancelled = deliveryReason({ state: "cancelled", errorCode: null });
    assert.equal(userCancelled.warn, false);
    assert.equal(userCancelled.canRewrite, true);
    assert.equal(deliveryReason({ state: "failed", errorCode: "auth" }).canRewrite, false, "실패는 서버 재시도를 쓴다");
});
test("UX-132 MIME·첨부·권한·한도·거절 사유 문구를 구분한다", () => {
    const codes = ["attachment_download", "attachment_changed", "mime_invalid", "auth", "scope", "rate_limited", "provider_rejected"];
    const texts = codes.map((errorCode) => deliveryReason({ state: "failed", errorCode }).text);
    assert.ok(texts.every(Boolean));
    assert.equal(new Set(texts).size, codes.length);
    assert.match(texts[3]!, /재연결/);
    assert.match(texts[5]!, /잠시 후/);
    assert.equal(deliveryReason({ state: "sent", errorCode: null }).text, null);
});
test("UX-134 결과 확인 필요는 자동 확인 중 문구와 경고를 보인다", () => {
    const r = deliveryReason({ state: "uncertain", errorCode: "network_unknown" });
    assert.match(r.text!, /자동으로 확인/);
    assert.equal(r.warn, true);
});
test("UX-131 실패 사유 문구와 재시도 가능 건수", () => {
    assert.equal(jobReasonLabel("invalid_source").permanent, true);
    assert.equal(jobReasonLabel("transient").permanent, false);
    assert.equal(jobReasonLabel(null).text, "기타 오류");
    assert.equal(retryableFailures([{ reasonCode: "invalid_source", count: 3 }, { reasonCode: "transient", count: 2 }, { reasonCode: null, count: 1 }]), 3);
    assert.equal(retryableFailures([{ reasonCode: "intake_rejected", count: 1 }]), 0);
});
