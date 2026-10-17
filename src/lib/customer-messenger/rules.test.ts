import test from "node:test";
import assert from "node:assert/strict";
import {
    customerWelcome,
    contactInput,
    messengerSettingsSchema,
    notificationDecision,
} from "./rules";
import { supportHoursText } from "@/components/customer-messenger/utils/presentation";
test("고객 본인에게 받은 이름으로 인사하고 익명 기본값은 노출하지 않는다", () => {
    assert.equal(
        customerWelcome("리베미코퍼레이션"),
        "안녕하세요, 리베미코퍼레이션님!",
    );
    assert.equal(customerWelcome("방문 고객"), "안녕하세요!");
    assert.equal(customerWelcome("고객님"), "안녕하세요, 고객님!");
});
test("실제 저장한 운영시간을 표시하고 빈 일정은 임의로 약속하지 않는다", () => {
    assert.equal(
        supportHoursText(
            [1, 2, 3, 4, 5].map((day) => ({
                day,
                start: "09:00",
                end: "17:00",
            })),
        ),
        "평일 09:00~17:00",
    );
    assert.match(supportHoursText([]), /확인/);
});
test("이메일 알림 선택에는 유효한 주소가 필요하고 연락처는 현재 문의용이다", () => {
    assert.equal(
        contactInput.safeParse({ action: "contact", notifyEmail: true })
            .success,
        false,
    );
    assert.equal(
        contactInput.safeParse({
            action: "contact",
            phone: "010-1234-5678",
            email: "qa@example.test",
        }).success,
        true,
    );
    assert.equal(
        contactInput.safeParse({ action: "contact", contactId: "untrusted" })
            .success,
        false,
    );
    assert.equal(
        messengerSettingsSchema.safeParse({
            consultationUrl: "javascript:alert(1)",
        }).success,
        false,
    );
});
test("읽은 답변·과거 기록·동의 해제·미인증·후속 답변에는 메일을 보내지 않는다", () => {
    const base = {
        enabled: true,
        consent: true,
        verified: true,
        read: false,
        superseded: false,
        historyOnly: false,
        medium: "web",
    };
    assert.equal(notificationDecision(base), "send");
    for (const patch of [
        { read: true },
        { consent: false },
        { verified: false },
        { historyOnly: true },
        { superseded: true },
        { medium: "email" },
        { enabled: false },
    ])
        assert.notEqual(notificationDecision({ ...base, ...patch }), "send");
});
