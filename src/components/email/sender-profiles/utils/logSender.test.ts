import { test } from "node:test";
import assert from "node:assert";
import { logSenderDetail, logSenderParts, logSenderText } from "./logSender";

// Q8 — 발송 이력에 보낸 주소 (실제 서버에서 어느 주소로 나갔는지 확인하는 칸)
// R7 — 로그마다 실제 보낸 주소(sender_email)를 쓰고, 프로필 주소를 바꿔도 과거 이력의 보낸 주소는 그대로 (DESIGN-3 4-1)

const profile = { id: 7, name: "영업 1", fromEmail: "sales1@example.test" };

test("R7: 저장된 보낸 주소(senderEmail)를 그대로 보인다", () => {
    const log = { senderEmail: "sales1@example.test", senderProfileId: 7, senderProfile: profile };
    assert.equal(logSenderText(log), "sales1@example.test");
    assert.deepEqual(logSenderParts(log), { email: "sales1@example.test", fromCurrentProfile: false });
    assert.equal(logSenderDetail(log), "영업 1 <sales1@example.test>");
});

test("R7: 보낸 뒤 프로필 주소를 바꿔도 표는 보낼 때 주소, 설명에 지금 프로필 주소", () => {
    const log = {
        senderEmail: "old@example.test",
        senderProfileId: 7,
        senderProfile: { id: 7, name: "영업 1", fromEmail: "new@example.test" },
    };
    assert.equal(logSenderText(log), "old@example.test");
    assert.equal(logSenderDetail(log), "영업 1 <old@example.test> — 지금 프로필 주소는 new@example.test");
});

test("R7: 주소 대소문자만 다르면 바뀐 것으로 보지 않는다", () => {
    const log = { senderEmail: "Sales1@Example.test", senderProfileId: 7, senderProfile: profile };
    assert.equal(logSenderDetail(log), "영업 1 <Sales1@Example.test>");
});

test("R7: 옛 이력(senderEmail 없음)은 프로필의 지금 주소에 '(현재 프로필)'", () => {
    for (const senderEmail of [undefined, null, "", "  "]) {
        const log = { senderEmail, senderProfileId: 7, senderProfile: profile };
        assert.equal(logSenderText(log), "sales1@example.test (현재 프로필)");
        assert.deepEqual(logSenderParts(log), { email: "sales1@example.test", fromCurrentProfile: true });
        assert.equal(logSenderDetail(log), "영업 1 <sales1@example.test> (현재 프로필 — 보낼 때 주소는 기록되지 않았습니다)");
    }
});

test("옛 이력에서 프로필 이름이 비었으면 주소만", () => {
    const log = { senderProfileId: 7, senderProfile: { id: 7, name: "", fromEmail: "sales1@example.test" } };
    assert.equal(logSenderDetail(log), "sales1@example.test (현재 프로필 — 보낼 때 주소는 기록되지 않았습니다)");
});

test("설정 발신자(프로필 없음)도 저장된 보낸 주소가 있으면 그 주소", () => {
    const log = { senderEmail: "noreply@example.test", senderProfileId: null, senderProfile: null };
    assert.equal(logSenderText(log), "noreply@example.test");
    assert.equal(logSenderDetail(log), "noreply@example.test");
});

test("기록이 없으면(senderEmail·senderProfile 없음) '—'", () => {
    assert.equal(logSenderText({ senderProfileId: null, senderProfile: null }), "—");
    assert.equal(logSenderDetail({ senderProfileId: null, senderProfile: null }), "—");
    assert.equal(logSenderText({}), "—");
    assert.deepEqual(logSenderParts({}), { email: null, fromCurrentProfile: false });
});

test("프로필을 지웠으면(서버가 null, id는 남음) 저장된 주소가 있으면 그 주소, 없으면 '—'. 설명에 번호", () => {
    const old = { senderProfileId: 7, senderProfile: null };
    assert.equal(logSenderText(old), "—");
    assert.equal(logSenderDetail(old), "— (지운 발신 프로필 #7)");

    const stored = { senderEmail: "sales1@example.test", senderProfileId: 7, senderProfile: null };
    assert.equal(logSenderText(stored), "sales1@example.test");
    assert.equal(logSenderDetail(stored), "sales1@example.test (지운 발신 프로필 #7)");
});
