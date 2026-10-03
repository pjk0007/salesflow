import { test } from "node:test";
import assert from "node:assert";
import { groupNotSent, recipientLabel } from "./sendResult";

// 수동 발송 결과: 보내지 않은 레코드를 이유별로 묶고 누구인지 함께 보인다

test("레코드 이름: 코드와 이메일, 없으면 레코드 번호", () => {
    assert.equal(recipientLabel({ recordId: 7, error: "x", code: "DH-0002", email: "a@b.test" }), "DH-0002 · a@b.test");
    assert.equal(recipientLabel({ recordId: 7, error: "x", code: null, email: "a@b.test" }), "a@b.test");
    assert.equal(recipientLabel({ recordId: 7, error: "x", code: " ", email: null }), "레코드 #7");
    assert.equal(recipientLabel({ recordId: 7, error: "x" }), "레코드 #7");
});

test("같은 이유끼리 묶고 많은 이유부터, 이유 안에서는 서버 순서", () => {
    const groups = groupNotSent([
        { recordId: 1, error: "수신거부한 주소입니다.", email: "u@x.test" },
        { recordId: 2, error: "한도", email: "a@x.test" },
        { recordId: 3, error: "한도", email: "b@x.test" },
    ]);
    assert.deepEqual(
        groups.map((g) => [g.message, g.count, g.recipients.map((r) => r.label)]),
        [
            ["한도", 2, ["a@x.test", "b@x.test"]],
            ["수신거부한 주소입니다.", 1, ["u@x.test"]],
        ],
    );
});

test("오류가 없으면 빈 목록", () => {
    assert.deepEqual(groupNotSent(undefined), []);
    assert.deepEqual(groupNotSent([]), []);
});
