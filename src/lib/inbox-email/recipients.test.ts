import test from "node:test";
import assert from "node:assert/strict";
import {
    replyRecipients,
    resolveRecipients,
    emailReplySelection,
} from "./recipients";
const input = {
    from: "sender@example.test",
    to: ["HELP@example.test", "to@example.test"],
    cc: ["TO@example.test", "cc@example.test", "sender@example.test"],
    deliveredTo: ["private@example.test"],
};
test("답장은 최신 발신자, 전체 회신은 보이는 To/Cc만 포함하고 자기 주소·중복·숨은참조 제외", () => {
    assert.deepEqual(replyRecipients(input, "help@example.test", "reply"), {
        to: [input.from],
        cc: [],
    });
    assert.deepEqual(replyRecipients(input, "help@example.test", "reply_all"), {
        to: [input.from],
        cc: ["to@example.test", "cc@example.test"],
    });
});
test("Reply-To가 있으면 발신자 대신 여러 회신 주소를 사용", () => {
    assert.deepEqual(
        replyRecipients(
            {
                ...input,
                replyTo: [
                    "reply@example.test",
                    "REPLY@example.test",
                    "second@example.test",
                ],
            },
            "help@example.test",
            "reply_all",
        ),
        {
            to: ["reply@example.test", "second@example.test"],
            cc: ["to@example.test", "cc@example.test", input.from],
        },
    );
});
test("직접 지정은 정규화·To 우선 중복 제거, 빈 대상/자기 주소/합계 30명 초과 거절", () => {
    assert.deepEqual(
        resolveRecipients(input, "help@example.test", {
            mode: "custom",
            sourceMessageId: 1,
            to: ["A@example.test", "a@example.test"],
            cc: ["a@example.test", "B@example.test"],
        }),
        { to: ["a@example.test"], cc: ["b@example.test"] },
    );
    for (const to of [
        [],
        ["help@example.test"],
        Array.from({ length: 31 }, (_, i) => `a${i}@example.test`),
    ])
        assert.throws(() =>
            resolveRecipients(input, "help@example.test", {
                mode: "custom",
                sourceMessageId: 1,
                to,
            }),
        );
});
test("일반/전체 회신에 임의 주소와 원본 없는 선택, 헤더 주입은 거절", () => {
    for (const value of [
        { mode: "reply_all", sourceMessageId: 1, to: ["a@example.test"] },
        { mode: "reply" },
        {
            mode: "custom",
            sourceMessageId: 1,
            to: ["a@example.test\r\nBcc:b@example.test"],
        },
    ])
        assert.equal(emailReplySelection.safeParse(value).success, false);
});
