import test from "node:test";
import assert from "node:assert/strict";
import { assertGoogleAlias, googleAccountAddress } from "./google-identity";
import { resolveRecipients, replyRecipients } from "./recipients";
import { mailboxInput } from "./rules";

test("기존 기본 메일함과 통합 Google 로그인 주소를 구분하고 정규화한다", () => {
    assert.equal(
        googleAccountAddress({ address: "help@example.test" }),
        "help@example.test",
    );
    const box = mailboxInput.parse({
        workspaceId: 8,
        address: "Help@Brand.test",
        googleAccount: " Support@Central.test ",
        name: "support",
    });
    assert.equal(box.address, "help@brand.test");
    assert.equal(googleAccountAddress(box), "support@central.test");
    assert.throws(() =>
        mailboxInput.parse({
            ...box,
            googleAccount: "a@example.test\r\nBcc: x@example.test",
        }),
    );
});
test("기본 주소는 별칭 권한 조회 없이 기존 연결을 유지한다", async () => {
    await assertGoogleAlias(
        "a@example.test",
        "a@example.test",
        "fake",
        async () => {
            throw new Error("unexpected network");
        },
    );
});
for (const scenario of ["accepted", "pending", "missing", "error"] as const) {
    test(`Gmail 발신 별칭 확인: ${scenario}`, async () => {
        const operation = assertGoogleAlias(
            "help@brand.test",
            "support@central.test",
            "fake",
            async (url, init) => {
                assert.equal(
                    String(url),
                    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
                );
                assert.equal(init?.method, undefined);
                if (scenario === "error")
                    return new Response("unavailable", { status: 503 });
                return Response.json({
                    sendAs:
                        scenario === "missing"
                            ? []
                            : [
                                  {
                                      sendAsEmail: "Help@Brand.test",
                                      verificationStatus: scenario,
                                  },
                              ],
                });
            },
        );
        if (scenario === "accepted") await operation;
        else await assert.rejects(operation);
    });
}
test("전체 회신·직접 지정에서 사업 주소와 통합 계정 자신을 제외한다", () => {
    const envelope = {
        from: "lead@example.test",
        to: ["help@brand.test", "support@central.test"],
        cc: ["colleague@example.test"],
    };
    assert.deepEqual(
        replyRecipients(envelope, "help@brand.test", "reply_all", [
            "support@central.test",
        ]),
        { to: ["lead@example.test"], cc: ["colleague@example.test"] },
    );
    assert.throws(() =>
        resolveRecipients(
            envelope,
            "help@brand.test",
            {
                mode: "custom",
                sourceMessageId: 1,
                to: ["support@central.test"],
            },
            ["support@central.test"],
        ),
    );
});
