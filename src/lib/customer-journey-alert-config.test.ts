import assert from "node:assert/strict";
import { test } from "node:test";
import { journeyAlertConfig } from "./customer-journey-alert-config";

const designer = "https://chat.googleapis.com/v1/spaces/designer/messages?key=fake&token=fake";
const backoffice = "https://chat.googleapis.com/v1/spaces/backoffice/messages?key=fake&token=fake";
const base = { JOURNEY_ALERT_MODE: "live", JOURNEY_ALERT_TEST_SERVER_LIVE: "1", JOURNEY_ALERT_WORKSPACE_IDS: "8,9" };

test("사업별 고객 여정은 서로 다른 스페이스로 연결된다", () => {
    const config = journeyAlertConfig({ ...base, JOURNEY_ALERT_WEBHOOKS_BY_WORKSPACE: JSON.stringify({ 8: designer, 9: backoffice }) });
    assert.equal(config.routes[8], designer);
    assert.equal(config.routes[9], backoffice);
    assert.deepEqual(config.readyIds, [8, 9]);
});

test("사업별 주소가 빠져도 공통 스페이스에 고객을 보내지 않는다", () => {
    const config = journeyAlertConfig({ ...base, JOURNEY_ALERT_WEBHOOK_URL: designer, JOURNEY_ALERT_WEBHOOKS_BY_WORKSPACE: JSON.stringify({ 8: designer }) });
    assert.deepEqual(config.readyIds, [8]);
    assert.deepEqual(config.missingIds, [9]);
    assert.equal(config.routes[9], undefined);
});

test("주소 목록에 있는 다른 사업도 허용 목록 없이는 발송하지 않는다", () => {
    const config = journeyAlertConfig({ ...base, JOURNEY_ALERT_WORKSPACE_IDS: "8", JOURNEY_ALERT_WEBHOOKS_BY_WORKSPACE: JSON.stringify({ 8: designer, 9: backoffice }) });
    assert.deepEqual(config.ids, [8]);
    assert.deepEqual(config.readyIds, [8]);
});

test("잘못된 사업별 주소 설정은 공통 주소로 대체하지 않고 중단한다", () => {
    for (const value of ["", "{broken", "null", "[]", JSON.stringify({ 8: designer, 9: "https://example.test/messages" }), JSON.stringify({ "8x": designer }), JSON.stringify({ 8: 123 })]) {
        const config = journeyAlertConfig({ ...base, JOURNEY_ALERT_WEBHOOK_URL: designer, JOURNEY_ALERT_WEBHOOKS_BY_WORKSPACE: value });
        assert.equal(config.configurationError, "invalid_workspace_webhooks");
        assert.deepEqual(config.readyIds, []);
    }
});

test("기존 공통 웹훅 설정은 사업별 설정을 사용하기 전까지 유지된다", () => {
    const config = journeyAlertConfig({ ...base, JOURNEY_ALERT_WEBHOOK_URL: designer });
    assert.deepEqual(config.readyIds, [8, 9]);
    assert.equal(config.routes[9], designer);
});

test("운영 설정 없는 개발 서버는 live를 요청해도 실제로 발송하지 않는다", () => {
    const config = journeyAlertConfig({ JOURNEY_ALERT_MODE: "live", JOURNEY_ALERT_WORKSPACE_IDS: "8", JOURNEY_ALERT_WEBHOOK_URL: designer });
    assert.equal(config.mode, "dry_run");
    assert.equal(journeyAlertConfig({}).mode, "off");
});
