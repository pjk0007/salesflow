/* eslint-disable @typescript-eslint/no-require-imports -- 가상 메일만 사용하는 격리 API/SQL QA */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
async function runEmailCheck(extra) {
    await require("./check-customer-platform.cjs").runPlatformCheck(
        async (ctx) => {
            const {
                db,
                pg,
                actor,
                otherActor,
                clients,
                channels,
                repo,
                platform,
            } = ctx;
            const s = require("../src/lib/db/schema.ts"),
                { eq } = require("drizzle-orm");
            const email = require("../src/lib/inbox-email/repository.ts");
            const {
                deliverGmailReply,
                receiveGmailPage,
            } = require("../src/lib/inbox-email/gmail.ts");
            const {
                clearGmailTokenCache,
            } = require("../src/lib/gmail-client.ts");
            const credentials = {
                clientId: "fake-client",
                clientSecret: "fake-secret",
                refreshToken: "fake-refresh",
            };
            const inbound = (n, overrides = {}) => ({
                providerMessageId: `in-${n}`,
                providerThreadId: "thread-dh",
                rfcMessageId: `<in-${n}@example.test>`,
                from: "lead@example.test",
                fromName: "가상 메일 고객",
                to: ["help-dh@example.test"],
                subject: "디자인 프로젝트 상담",
                body: `가상 문의 ${n}: 진행 방법이 궁금합니다.`,
                receivedAt: new Date(
                    Date.now() - 10000 + n * 100,
                ).toISOString(),
                ...overrides,
            });
            let checks = 0,
                box,
                bo,
                received;
            const check = async (name, fn) => {
                await fn();
                console.log(`PASS EMAIL ${++checks} ${name}`);
            };
            const count = async (table) =>
                (await db.select().from(table)).length;
            const getDelivery = async (id) =>
                (
                    await db
                        .select()
                        .from(s.inboxEmailDeliveries)
                        .where(eq(s.inboxEmailDeliveries.id, id))
                )[0];
            const reply = async (body = "가상 이메일 답장") =>
                clients.dh.reply(received.conversationId, body, randomUUID());
            const lease = () => clients.dh.claimEmail(box.id);
            try {
                await check(
                    "메일함 기본 중지·사업 권한·중복 주소",
                    async () => {
                        box = await clients.dh.createEmailMailbox({
                            workspaceId: 8,
                            address: "help-dh@example.test",
                            name: "디하 상담 메일",
                        });
                        bo = await clients.bo.createEmailMailbox({
                            workspaceId: 10,
                            address: "help-bo@example.test",
                            name: "백오랩 상담 메일",
                        });
                        assert.equal(box.enabled, false);
                        await assert.rejects(
                            clients.dh.receiveEmail(box.id, inbound(1)),
                            (e) => e.status === 409,
                        );
                        await assert.rejects(
                            clients.bo.emailMailboxes(8),
                            (e) => e.status === 403,
                        );
                        await assert.rejects(
                            clients.read.createEmailMailbox({
                                workspaceId: 8,
                                address: "blocked@example.test",
                                name: "차단",
                            }),
                            (e) => e.status === 403,
                        );
                        await assert.rejects(
                            email.ownedMailbox(otherActor, box.id, db),
                            (e) => e.status === 404,
                        );
                        await assert.rejects(
                            clients.dh.createEmailMailbox({
                                workspaceId: 8,
                                address: box.address,
                                name: "중복",
                            }),
                            (e) => e.status === 409,
                        );
                        box = await clients.dh.changeEmailMailbox(
                            box.id,
                            box.version,
                            true,
                        );
                        bo = await clients.bo.changeEmailMailbox(
                            bo.id,
                            bo.version,
                            true,
                        );
                    },
                );
                const original = inbound(1);
                await check("수신→고객·상담·타임라인·발송 없음", async () => {
                    await platform.upsertContact(
                        actor.orgId,
                        {
                            workspaceId: 8,
                            externalId: "unrelated-member",
                            name: "같은 이메일 회원",
                            email: original.from,
                        },
                        db,
                    );
                    received = await clients.dh.receiveEmail(box.id, original);
                    const detail = await repo.conversationDetail(
                        actor,
                        received.conversationId,
                        db,
                    );
                    assert.equal(detail.conversation.medium, "email");
                    assert.equal(detail.conversation.aiState, "human");
                    assert.equal(
                        detail.conversation.emailContext.recipient,
                        original.from,
                    );
                    assert.equal(
                        detail.messages[0].email.providerMessageId,
                        original.providerMessageId,
                    );
                    const contact = await platform.platformContact(
                        actor.orgId,
                        8,
                        detail.conversation.contactId,
                        db,
                    );
                    assert.notEqual(contact.externalId, "unrelated-member");
                    assert.equal(contact.attributes.source, "email");
                    assert.equal(await count(s.inboxEmailDeliveries), 0);
                    assert.equal(await count(s.customerAiJobs), 0);
                    assert.ok(
                        (await db.select().from(s.crmActivities)).some(
                            (a) =>
                                a.contactId === contact.id &&
                                a.summary.includes("가상 문의"),
                        ),
                    );
                });
                await check(
                    "동일 메일 재수신 멱등·내용 충돌·다른 사업 수신 차단",
                    async () => {
                        const before = await count(s.inboxMessages);
                        assert.equal(
                            (await clients.dh.receiveEmail(box.id, original))
                                .duplicate,
                            true,
                        );
                        assert.equal(await count(s.inboxMessages), before);
                        await assert.rejects(
                            clients.dh.receiveEmail(box.id, {
                                ...original,
                                body: "변조",
                            }),
                            (e) => e.status === 409,
                        );
                        await assert.rejects(
                            clients.bo.receiveEmail(box.id, original),
                            (e) => e.status === 403,
                        );
                        await assert.rejects(
                            clients.dh.receiveEmail(
                                box.id,
                                inbound(2, { to: [bo.address] }),
                            ),
                            (e) => e.status === 409,
                        );
                    },
                );
                await check(
                    "스레드 참여자 혼합 차단·서로 다른 스레드 허용",
                    async () => {
                        await assert.rejects(
                            clients.dh.receiveEmail(
                                box.id,
                                inbound(2, { from: "other@example.test" }),
                            ),
                            (e) => e.status === 409,
                        );
                        const second = await clients.dh.receiveEmail(
                            box.id,
                            inbound(3, { providerThreadId: "thread-dh-two" }),
                        );
                        assert.notEqual(
                            second.conversationId,
                            received.conversationId,
                        );
                        const a = await repo.ownedConversation(
                                actor,
                                second.conversationId,
                                db,
                            ),
                            b = await repo.ownedConversation(
                                actor,
                                received.conversationId,
                                db,
                            );
                        assert.equal(a.contactId, b.contactId);
                        const reopened = await repo.patchConversation(
                            actor,
                            received.conversationId,
                            { status: "closed", version: b.version },
                            db,
                        );
                        const next = await clients.dh.receiveEmail(
                            box.id,
                            inbound(4),
                        );
                        assert.equal(next.conversationId, reopened.id);
                        assert.equal(
                            (
                                await repo.ownedConversation(
                                    actor,
                                    reopened.id,
                                    db,
                                )
                            ).status,
                            "open",
                        );
                    },
                );
                await check(
                    "자동 회신·자기 메일은 상담/답장 생성 제외",
                    async () => {
                        const before = await count(s.inboxMessages);
                        for (const overrides of [
                            { autoSubmitted: "auto-replied" },
                            { from: box.address },
                            { precedence: "bulk" },
                        ])
                            assert.ok(
                                (
                                    await clients.dh.receiveEmail(
                                        box.id,
                                        inbound(10 + checks, {
                                            ...overrides,
                                            providerMessageId: randomUUID(),
                                        }),
                                    )
                                ).ignoredReason,
                            );
                        assert.equal(await count(s.inboxMessages), before);
                    },
                );
                await check(
                    "내부 메모 발송 제외·답장과 대기열 원자 저장·중복 답장",
                    async () => {
                        await clients.dh.reply(
                            received.conversationId,
                            "내부 비밀 메모",
                            randomUUID(),
                            "note",
                        );
                        assert.equal(await count(s.inboxEmailDeliveries), 0);
                        const id = randomUUID();
                        await clients.dh.reply(
                            received.conversationId,
                            "가상 원자 답장",
                            id,
                        );
                        await clients.dh.reply(
                            received.conversationId,
                            "가상 원자 답장",
                            id,
                        );
                        assert.equal(await count(s.inboxEmailDeliveries), 1);
                        const detail = await repo.conversationDetail(
                            actor,
                            received.conversationId,
                            db,
                        );
                        assert.equal(
                            detail.messages.at(-1).delivery.state,
                            "queued",
                        );
                    },
                );
                await check("임대→발송 시작→접수·결과 등록 멱등", async () => {
                    const item = await lease();
                    assert.equal(item.state, "leased");
                    assert.equal(await lease(), null);
                    assert.equal(item.inReplyTo, "<in-4@example.test>");
                    await clients.dh.changeEmailDelivery(item.id, {
                        action: "begin",
                        leaseToken: item.leaseToken,
                    });
                    await assert.rejects(
                        clients.bo.changeEmailDelivery(item.id, {
                            action: "sent",
                            leaseToken: item.leaseToken,
                            providerMessageId: "g1",
                        }),
                        (e) => e.status === 403,
                    );
                    for (let i = 0; i < 2; i++)
                        await clients.dh.changeEmailDelivery(item.id, {
                            action: "sent",
                            leaseToken: item.leaseToken,
                            providerMessageId: "g1",
                        });
                    assert.equal((await getDelivery(item.id)).state, "sent");
                });
                await check(
                    "발송 전 임대 만료 재획득·이전 작업자 시작 차단",
                    async () => {
                        await reply();
                        const old = await lease();
                        await db
                            .update(s.inboxEmailDeliveries)
                            .set({ leaseUntil: new Date(0) })
                            .where(eq(s.inboxEmailDeliveries.id, old.id));
                        const current = await lease();
                        assert.notEqual(old.leaseToken, current.leaseToken);
                        await assert.rejects(
                            clients.dh.changeEmailDelivery(old.id, {
                                action: "begin",
                                leaseToken: old.leaseToken,
                            }),
                            (e) => e.status === 409,
                        );
                        await clients.dh.changeEmailDelivery(current.id, {
                            action: "cancel",
                        });
                    },
                );
                await check(
                    "발송 시작 후 임대 만료는 확인 필요·재전송 차단·늦은 성공 등록",
                    async () => {
                        await reply();
                        const item = await lease();
                        await clients.dh.changeEmailDelivery(item.id, {
                            action: "begin",
                            leaseToken: item.leaseToken,
                        });
                        await db
                            .update(s.inboxEmailDeliveries)
                            .set({ leaseUntil: new Date(0) })
                            .where(eq(s.inboxEmailDeliveries.id, item.id));
                        assert.equal(await lease(), null);
                        assert.equal(
                            (await getDelivery(item.id)).state,
                            "uncertain",
                        );
                        await assert.rejects(
                            clients.dh.changeEmailDelivery(item.id, {
                                action: "retry",
                            }),
                            (e) => e.status === 409,
                        );
                        await clients.dh.changeEmailDelivery(item.id, {
                            action: "sent",
                            leaseToken: item.leaseToken,
                            providerMessageId: "g-late",
                        });
                        assert.equal(
                            (await getDelivery(item.id)).state,
                            "sent",
                        );
                    },
                );
                await check(
                    "확실한 실패만 사람 재시도·메일함 중지와 설정 세대",
                    async () => {
                        await reply();
                        let item = await lease();
                        await clients.dh.changeEmailDelivery(item.id, {
                            action: "begin",
                            leaseToken: item.leaseToken,
                        });
                        for (let i = 0; i < 2; i++)
                            await clients.dh.changeEmailDelivery(item.id, {
                                action: "failed",
                                leaseToken: item.leaseToken,
                                errorCode: "provider_rejected",
                            });
                        await clients.dh.changeEmailDelivery(item.id, {
                            action: "retry",
                        });
                        item = await lease();
                        box = await clients.dh.changeEmailMailbox(
                            box.id,
                            box.version,
                            false,
                        );
                        assert.equal(
                            (await getDelivery(item.id)).state,
                            "cancelled",
                        );
                        await assert.rejects(
                            clients.dh.changeEmailDelivery(item.id, {
                                action: "begin",
                                leaseToken: item.leaseToken,
                            }),
                            (e) => e.status === 409,
                        );
                        const before = await count(s.inboxMessages);
                        await assert.rejects(reply(), (e) => e.status === 409);
                        assert.equal(await count(s.inboxMessages), before);
                        box = await clients.dh.changeEmailMailbox(
                            box.id,
                            box.version,
                            true,
                        );
                        assert.equal(await lease(), null);
                    },
                );
                await check(
                    "수신 저장 실패 시 메시지·CRM·수신 번호 롤백",
                    async () => {
                        const before = await count(s.inboxMessages),
                            act = await count(s.crmActivities);
                        await pg.exec(
                            "CREATE FUNCTION fail_email_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa_receipt_fail'; END $$; CREATE TRIGGER qa_receipt_fail BEFORE INSERT ON inbox_email_receipts FOR EACH ROW EXECUTE FUNCTION fail_email_receipt();",
                        );
                        await assert.rejects(
                            email.receiveEmail(actor, box.id, inbound(30), db),
                        );
                        assert.equal(await count(s.inboxMessages), before);
                        assert.equal(await count(s.crmActivities), act);
                        await pg.exec(
                            "DROP TRIGGER qa_receipt_fail ON inbox_email_receipts; DROP FUNCTION fail_email_receipt();",
                        );
                        assert.equal(
                            (await clients.dh.receiveEmail(box.id, inbound(30)))
                                .duplicate,
                            false,
                        );
                    },
                );
                await check(
                    "백오랩 Gmail 형식 수신·페이지 커서·프로필 확인",
                    async () => {
                        clearGmailTokenCache();
                        const paths = [];
                        const fake = async (url) => {
                            paths.push(String(url));
                            if (String(url).includes("oauth2"))
                                return Response.json({
                                    access_token: "fake-access",
                                    expires_in: 3600,
                                });
                            if (String(url).endsWith("profile"))
                                return Response.json({
                                    emailAddress: bo.address,
                                });
                            if (String(url).includes("messages?"))
                                return Response.json({
                                    messages: [{ id: "gmail-bo-1" }],
                                    nextPageToken: "page-two",
                                });
                            return Response.json({
                                id: "gmail-bo-1",
                                threadId: "gmail-bo-thread",
                                internalDate: String(Date.now()),
                                payload: {
                                    mimeType: "text/plain",
                                    headers: [
                                        {
                                            name: "From",
                                            value: "가상 백오랩 고객 <bo-lead@example.test>",
                                        },
                                        { name: "To", value: bo.address },
                                        {
                                            name: "Subject",
                                            value: "백오피스 문의",
                                        },
                                        {
                                            name: "Message-ID",
                                            value: "<bo-1@example.test>",
                                        },
                                    ],
                                    body: {
                                        data: Buffer.from(
                                            "세무 상담을 부탁드립니다.",
                                        ).toString("base64url"),
                                    },
                                },
                            });
                        };
                        const result = await receiveGmailPage(
                            clients.bo,
                            {
                                workspaceId: 10,
                                mailboxId: bo.id,
                                since: new Date("2026-10-14"),
                            },
                            credentials,
                            fake,
                        );
                        assert.equal(result.nextPageToken, "page-two");
                        assert.equal(result.results.length, 1);
                        const detail = await repo.conversationDetail(
                            actor,
                            result.results[0].conversationId,
                            db,
                        );
                        assert.equal(
                            detail.conversation.channelId,
                            channels.bo.id,
                        );
                        assert.ok(paths.some((p) => p.includes("format=full")));
                        assert.ok(!paths.some((p) => p.includes("modify")));
                    },
                );
                await check(
                    "Gmail 답장 MIME/스레드·단일 POST·접수·5xx 확인 필요",
                    async () => {
                        clearGmailTokenCache();
                        let sends = 0,
                            unknown = false;
                        const fake = async (url, init) => {
                            if (String(url).includes("oauth2"))
                                return Response.json({
                                    access_token: "fake-access",
                                    expires_in: 3600,
                                });
                            if (String(url).endsWith("profile"))
                                return Response.json({
                                    emailAddress: box.address,
                                });
                            sends++;
                            const payload = JSON.parse(init.body),
                                raw = Buffer.from(
                                    payload.raw,
                                    "base64url",
                                ).toString();
                            assert.equal(payload.threadId, "thread-dh");
                            assert.ok(
                                raw.includes(
                                    "In-Reply-To: <in-30@example.test>",
                                ),
                            );
                            assert.ok(raw.includes("Message-ID:"));
                            return unknown
                                ? new Response("unavailable", { status: 503 })
                                : Response.json({ id: "gmail-sent-1" });
                        };
                        await reply(
                            "고객님, 안내드립니다. 요청 내용을 확인했습니다.",
                        );
                        const result = await deliverGmailReply(
                            clients.dh,
                            box.id,
                            credentials,
                            fake,
                        );
                        assert.equal(result.state, "sent");
                        assert.equal(sends, 1);
                        unknown = true;
                        await reply("두 번째 가상 답장");
                        const pending = await deliverGmailReply(
                            clients.dh,
                            box.id,
                            credentials,
                            fake,
                        );
                        assert.equal(pending.state, "uncertain");
                        assert.equal(sends, 2);
                        assert.equal(await lease(), null);
                        await assert.rejects(
                            clients.dh.changeEmailDelivery(pending.deliveryId, {
                                action: "retry",
                            }),
                            (e) => e.status === 409,
                        );
                    },
                );
                await check(
                    "이메일 상담은 웹 회원 이력·자동 발송으로 노출되지 않음",
                    async () => {
                        const chat = await repo.ownedConversation(
                                actor,
                                received.conversationId,
                                db,
                            ),
                            contact = await platform.platformContact(
                                actor.orgId,
                                8,
                                chat.contactId,
                                db,
                            );
                        const identity = await clients.dh.customerIdentity(
                            channels.dh.id,
                            contact.id,
                        );
                        const { NextRequest } = require("next/server"),
                            mod = ctx.modules["messenger/[key]"];
                        const response = await mod.GET(
                            new NextRequest(
                                `http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}`,
                                {
                                    headers: {
                                        authorization: `Bearer ${identity.identityToken}`,
                                    },
                                },
                            ),
                            {
                                params: Promise.resolve({
                                    key: channels.dh.publicKey,
                                }),
                            },
                        );
                        const result = (await response.json()).data;
                        assert.equal(result.messages.length, 0);
                        await assert.rejects(
                            repo.sendSystemReply(
                                db,
                                received.conversationId,
                                "자동 발송 차단",
                                randomUUID(),
                            ),
                            (e) => e.status === 409,
                        );
                        assert.equal(await count(s.customerAiJobs), 0);
                    },
                );
                console.log(
                    `이메일 상담 QA ${checks}개 통과 · 실제 메일/운영 DB 접근 0건`,
                );
                if (extra)
                    await extra({
                        ...ctx,
                        email,
                        emailMailboxes: { dh: box, bo },
                        emailConversation: received.conversationId,
                    });
                else await pg.close();
            } catch (e) {
                throw e;
            }
        },
    );
}
if (require.main === module)
    runEmailCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runEmailCheck };
