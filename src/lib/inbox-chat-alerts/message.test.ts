import { test } from "node:test";
import assert from "node:assert/strict";
import { chatAlertMessages, splitMessage, alertMessageId, conversationLink } from "./message";
import { chatAlertRoutes, routeFingerprint } from "./config";

const route = { orgId: "00000000-0000-4000-8000-000000000001", workspaceId: 8, channelId: 1, webhook: "https://chat.googleapis.com/v1/spaces/fake/messages?key=fake&token=fake" };
const message = { id: 52, conversationId: "00000000-0000-4000-8000-000000000003", channelId: 1, name: "가상 고객", channelName: "디하", body: "안녕하세요.\n견적이 궁금합니다. <users/all> & <script>", createdAt: new Date("2026-10-19T02:00:00Z"), medium: "web", status: "closed", attachments: ["견적<가상>.pdf"] };
test("고객 원문 줄바꿈과 특수문자를 보존하고 멘션·HTML은 실행하지 않는다", () => {
    const [payload] = chatAlertMessages(message, "https://sendb.kr");
    const widgets = payload.cardsV2[0].card.sections[0].widgets;
    assert.equal(widgets[0].textParagraph!.text, "안녕하세요.<br>견적이 궁금합니다. &lt;users/all&gt; &amp; &lt;script&gt;");
    assert.match(JSON.stringify(payload), /견적&lt;가상&gt;.pdf/);
    assert.ok(!JSON.stringify(payload).includes("<users/all>"));
});
test("긴 원문은 잘리지 않고 Unicode 글자 단위로 나뉘며 카드 예산을 지킨다", () => {
    const body = "< & 한글🙂\n".repeat(3000), chunks = splitMessage(body);
    assert.equal(chunks.join(""), body); assert.ok(chunks.length > 2);
    for (const payload of chatAlertMessages({ ...message, body }, "https://sendb.kr")) {
        assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 30000);
        assert.ok(!JSON.stringify(payload).includes("�"));
    }
});
test("닫힌 상담도 정확한 채널·메시지·상태로 열고 부분 재시도 ID가 고정된다", () => {
    const url = new URL(conversationLink(message, "https://sendb.kr"));
    assert.equal(url.origin, "https://sendb.kr"); assert.equal(url.pathname, "/inbox");
    assert.equal(url.searchParams.get("status"), "closed");
    assert.equal(url.searchParams.get("message"), "52");
    const fingerprint = routeFingerprint(route);
    assert.match(alertMessageId(fingerprint, 52, 0), /^client-[a-z0-9-]{1,56}$/);
    assert.equal(alertMessageId(fingerprint, 52, 0), alertMessageId(fingerprint, 52, 0));
    assert.notEqual(alertMessageId(fingerprint, 52, 0), alertMessageId(fingerprint, 52, 1));
    assert.notEqual(alertMessageId(fingerprint, 52, 0), alertMessageId(routeFingerprint({ ...route, channelId: 3 }), 52, 0));
});
test("명시된 조직·사업·채널만 연결하며 잘못된 설정·개발 서버는 발송하지 않는다", () => {
    const env = { INBOX_CHAT_ALERTS: "on", INBOX_CHAT_ALERT_ROUTES: JSON.stringify([route]) };
    assert.deepEqual(chatAlertRoutes(env), [route]);
    for (const routes of [[route, route], [{ ...route, webhook: "https://evil.test/" }], [{ ...route, workspaceId: "8" }]]) {
        assert.deepEqual(chatAlertRoutes({ ...env, INBOX_CHAT_ALERT_ROUTES: JSON.stringify(routes) }), []);
    }
    assert.deepEqual(chatAlertRoutes({ ...env, INBOX_CHAT_ALERTS: "off" }), []);
    assert.deepEqual(chatAlertRoutes({ ...env, NEXT_PUBLIC_APP_URL: "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app" }), []);
});
