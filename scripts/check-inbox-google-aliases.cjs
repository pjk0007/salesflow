/* eslint-disable @typescript-eslint/no-require-imports -- 격리 DB와 가상 Google HTTP만 사용 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
require("./check-inbox-google.cjs")
    .runGoogleCheck(
        async ({ db, pg, actor, otherActor, repo, googleConfig: cfg }) => {
            const email = require("../src/lib/inbox-email/repository.ts"),
                oauth = require("../src/lib/inbox-email/google-connection.ts"),
                gmail = require("../src/lib/inbox-email/gmail.ts"),
                {
                    googleTransport,
                } = require("../src/lib/inbox-email/google-transport.ts"),
                s = require("../src/lib/db/schema.ts"),
                { eq } = require("drizzle-orm"),
                account = "support@central.example.test",
                aliases = [
                    "support@brand-a.example.test",
                    "support@brand-b.example.test",
                ];
            let accepted = true,
                sends = 0,
                checks = 0;
            const check = async (name, fn) => {
                await fn();
                console.log(`PASS ALIAS ${++checks} ${name}`);
            };
            const boxA = await email.createMailbox(
                actor,
                {
                    workspaceId: 8,
                    address: aliases[0],
                    googleAccount: account,
                    name: "support",
                },
                db,
            );
            const boxB = await email.createMailbox(
                actor,
                {
                    workspaceId: 10,
                    address: aliases[1],
                    googleAccount: account,
                    name: "support",
                },
                db,
            );
            const read = async (table, field, value) =>
                (await db.select().from(table).where(eq(field, value)))[0];
            const fake = async (url, init = {}) => {
                const u = new URL(String(url));
                if (u.origin === "https://oauth2.googleapis.com")
                    return Response.json({
                        access_token: "fake-shared-account",
                        refresh_token: "fake-shared-refresh",
                        expires_in: 3600,
                        scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
                    });
                assert.equal(u.origin, "https://gmail.googleapis.com");
                if (u.pathname.endsWith("/profile"))
                    return Response.json({
                        emailAddress: account,
                        historyId: "1000",
                    });
                if (u.pathname.endsWith("/settings/sendAs"))
                    return Response.json({
                        sendAs: aliases.map((a) => ({
                            sendAsEmail: a,
                            verificationStatus: accepted
                                ? "accepted"
                                : "pending",
                        })),
                    });
                if (u.pathname.endsWith("/messages/send")) {
                    const raw = Buffer.from(
                        JSON.parse(init.body).raw,
                        "base64url",
                    ).toString();
                    assert.ok(raw.includes(`<${aliases[0]}>`));
                    assert.ok(!raw.includes(`Cc: ${account}`));
                    sends++;
                    return Response.json({ id: "fake_alias_sent" });
                }
                if (u.pathname.endsWith("/messages/alias_source"))
                    return Response.json({
                        id: "alias_source",
                        threadId: "alias_thread",
                        internalDate: String(Date.now()),
                        labelIds: ["INBOX"],
                        payload: {
                            mimeType: "text/plain",
                            headers: [
                                { name: "From", value: "lead@example.test" },
                                { name: "To", value: aliases[0] },
                                { name: "Delivered-To", value: account },
                                {
                                    name: "Message-ID",
                                    value: "<alias_source@example.test>",
                                },
                                { name: "Subject", value: "사업별 문의" },
                            ],
                            body: {
                                data: Buffer.from("가상 문의입니다").toString(
                                    "base64url",
                                ),
                            },
                        },
                    });
                throw new Error(`unexpected fake request ${u.pathname}`);
            };
            const connect = async (box) => {
                const b = await read(
                    s.inboxMailboxes,
                    s.inboxMailboxes.id,
                    box.id,
                );
                const started = await oauth.beginGoogleConnection(
                    actor,
                    box.id,
                    { version: b.version, lookbackDays: 0 },
                    "http://127.0.0.1:3120",
                    db,
                    cfg,
                );
                assert.equal(
                    new URL(started.authorizationUrl).searchParams.get(
                        "login_hint",
                    ),
                    account,
                );
                return oauth.finishGoogleConnection(
                    actor,
                    {
                        state: new URL(
                            started.authorizationUrl,
                        ).searchParams.get("state"),
                        cookie: started.cookie,
                        code: "fake-alias",
                    },
                    db,
                    cfg,
                    fake,
                );
            };
            try {
                await check(
                    "두 사업의 문의 주소를 하나의 Google 계정으로 승인",
                    async () => {
                        await connect(boxA);
                        await connect(boxB);
                    },
                );
                await check(
                    "인증되지 않은 별칭은 OAuth 연결 단계에서 차단",
                    async () => {
                        accepted = false;
                        await assert.rejects(connect(boxB), /인증된 발신/);
                        accepted = true;
                    },
                );
                await check(
                    "연결된 계정 변경과 다른 조직 접근 차단",
                    async () => {
                        await assert.rejects(
                            email.changeMailbox(
                                actor,
                                boxA.id,
                                {
                                    version: (
                                        await read(
                                            s.inboxMailboxes,
                                            s.inboxMailboxes.id,
                                            boxA.id,
                                        )
                                    ).version,
                                    enabled: false,
                                    googleAccount: "other@example.test",
                                },
                                db,
                            ),
                            /먼저 해제/,
                        );
                        await assert.rejects(
                            email.ownedMailbox(otherActor, boxA.id, db),
                        );
                    },
                );
                const connection = await read(
                    s.inboxGoogleConnections,
                    s.inboxGoogleConnections.mailboxId,
                    boxA.id,
                );
                const box = await read(
                    s.inboxMailboxes,
                    s.inboxMailboxes.id,
                    boxA.id,
                );
                await email.changeMailbox(
                    actor,
                    box.id,
                    { version: box.version, enabled: true },
                    db,
                );
                const transport = googleTransport(
                    actor,
                    connection.version,
                    db,
                    () => new Date(),
                );
                const credentials = {
                    clientId: cfg.clientId,
                    clientSecret: cfg.clientSecret,
                    refreshToken: "fake-shared-refresh",
                };
                let received;
                await check(
                    "브랜드 A 문의는 A에 수신하고 B로 유입되지 않음",
                    async () => {
                        received = await gmail.receiveGmailMessage(
                            transport,
                            {
                                mailboxId: boxA.id,
                                address: boxA.address,
                                messageId: "alias_source",
                                since: new Date(Date.now() - 10000),
                            },
                            credentials,
                            fake,
                        );
                        const skipped = await gmail.receiveGmailMessage(
                            transport,
                            {
                                mailboxId: boxB.id,
                                address: boxB.address,
                                messageId: "alias_source",
                                since: new Date(Date.now() - 10000),
                            },
                            credentials,
                            fake,
                        );
                        assert.equal(skipped.skippedReason, "other_recipient");
                        assert.ok(received.receipt.conversationId);
                    },
                );
                const reply = () =>
                    repo.sendAgentMessage(
                        actor,
                        received.receipt.conversationId,
                        {
                            clientId: randomUUID(),
                            body: "가상 답장",
                            kind: "reply",
                        },
                        db,
                    );
                await check(
                    "기본 계정에서 사업 주소를 From으로 유지해 전송",
                    async () => {
                        await reply();
                        const result = await gmail.deliverGmailReply(
                            transport,
                            boxA.id,
                            credentials,
                            fake,
                        );
                        assert.equal(result.state, "sent");
                        assert.equal(sends, 1);
                    },
                );
                await check(
                    "승인 후 별칭 인증이 해제되면 실제 발송 직전 차단",
                    async () => {
                        await reply();
                        accepted = false;
                        const result = await gmail.deliverGmailReply(
                            transport,
                            boxA.id,
                            credentials,
                            fake,
                        );
                        assert.equal(result.state, "failed");
                        assert.equal(sends, 1);
                        const delivery = await read(
                            s.inboxEmailDeliveries,
                            s.inboxEmailDeliveries.id,
                            result.deliveryId,
                        );
                        assert.equal(delivery.errorCode, "alias_unverified");
                    },
                );
                await check(
                    "연결 해제 후 로그인 계정 변경은 중지와 버전 갱신",
                    async () => {
                        await oauth.disconnectGoogle(
                            actor,
                            boxA.id,
                            connection.version,
                            db,
                        );
                        const b = await read(
                            s.inboxMailboxes,
                            s.inboxMailboxes.id,
                            boxA.id,
                        );
                        const changed = await email.changeMailbox(
                            actor,
                            boxA.id,
                            {
                                version: b.version,
                                enabled: false,
                                googleAccount: "new@example.test",
                            },
                            db,
                        );
                        assert.equal(changed.enabled, false);
                        assert.equal(changed.googleAccount, "new@example.test");
                        assert.equal(changed.version, b.version + 1);
                    },
                );
                console.log(
                    `별칭 연결·사업 격리·발송 검증 ${checks}개 통과 · 실제 외부 발송 0건`,
                );
            } finally {
                await pg.close();
            }
        },
    )
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
