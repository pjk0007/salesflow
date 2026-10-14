/* eslint-disable @typescript-eslint/no-require-imports -- 가상 메일과 격리 SQL/API만 사용 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function runRecipientCheck(extra) {
    return runPlatformCheck(async (ctx) => {
        const { db, pg, otherActor, clients, channels, repo } = ctx,
            s = require("../src/lib/db/schema.ts"),
            { eq } = require("drizzle-orm"),
            {
                gmailReplyRaw,
                gmailInbound,
            } = require("../src/lib/inbox-email/gmail.ts");
        let n = 0,
            checks = 0;
        const check = async (name, fn) => {
            await fn();
            console.log(`PASS RECIPIENTS ${++checks} ${name}`);
        };
        const boxes = {};
        for (const [name, workspaceId] of [
            ["dh", 8],
            ["bo", 10],
        ]) {
            let box = await clients[name].createEmailMailbox({
                workspaceId,
                address: `reply-${name}@example.test`,
                name: `가상 ${name} 회신`,
            });
            boxes[name] = await clients[name].changeEmailMailbox(
                box.id,
                box.version,
                true,
            );
        }
        const inbound = (name = "dh", change = {}) => {
            const i = ++n;
            return {
                providerMessageId: `recipients-${i}`,
                providerThreadId: "shared-thread",
                rfcMessageId: `<r${i}@example.test>`,
                from: "first@example.test",
                fromName: "가상 최초 문의자",
                to: [boxes[name].address, "teammate@example.test"],
                cc: ["manager@example.test"],
                subject: "가상 도입 상담",
                body: "가상 문의 " + i,
                receivedAt: new Date(Date.now() + i * 1000).toISOString(),
                ...change,
            };
        };
        let received, contactId, first, latest, selected, replyId, delivery;
        const details = () =>
                clients.dh.inboxConversation(received.conversationId),
            reply = (
                selection,
                clientId = randomUUID(),
                body = "가상 전체 회신",
            ) =>
                clients.dh.reply(
                    received.conversationId,
                    body,
                    clientId,
                    "reply",
                    [],
                    undefined,
                    selection,
                ),
            deliveryFor = async (messageId) =>
                (
                    await db
                        .select()
                        .from(s.inboxEmailDeliveries)
                        .where(eq(s.inboxEmailDeliveries.messageId, messageId))
                )[0];
        await check("기본 회신 대상·다중 To/Cc와 숨은참조 비공개", async () => {
            first = inbound("dh", {
                deliveredTo: [boxes.dh.address, "bcc-hidden@example.test"],
            });
            received = await clients.dh.receiveEmail(boxes.dh.id, first);
            const d = await details();
            contactId = d.conversation.contactId;
            assert.deepEqual(d.conversation.emailContext.replyTo, [
                "first@example.test",
            ]);
            assert.deepEqual(d.conversation.emailContext.replyAllCc, [
                "teammate@example.test",
                "manager@example.test",
            ]);
            assert.equal(
                d.conversation.emailContext.sourceMessageId,
                received.messageId,
            );
            assert.equal(
                JSON.stringify(d.conversation.emailContext).includes(
                    "bcc-hidden",
                ),
                false,
            );
        });
        await check(
            "같은 스레드 다른 발신자·Reply-To, 최초 CRM 고객 유지·메시지별 원본",
            async () => {
                latest = inbound("dh", {
                    from: "second@example.test",
                    fromName: "가상 동료",
                    replyTo: [
                        "reply@example.test",
                        "second-reply@example.test",
                    ],
                    to: [boxes.dh.address, "second@example.test"],
                    cc: ["manager@example.test", "SECOND@example.test"],
                });
                const r = await clients.dh.receiveEmail(boxes.dh.id, latest),
                    d = await details();
                assert.equal(r.conversationId, received.conversationId);
                assert.equal(d.conversation.contactId, contactId);
                assert.equal(
                    d.messages.find((m) => m.id === r.messageId).email.from,
                    latest.from,
                );
                assert.deepEqual(
                    d.conversation.emailContext.replyTo,
                    latest.replyTo,
                );
                assert.deepEqual(d.conversation.emailContext.replyAllCc, [
                    "second@example.test",
                    "manager@example.test",
                ]);
                selected = { mode: "reply_all", sourceMessageId: r.messageId };
            },
        );
        await check(
            "최신 수신 기준 전체 회신 큐·API claim·MIME 받는 사람과 참조",
            async () => {
                replyId = randomUUID();
                const message = await reply(selected, replyId);
                delivery = await deliveryFor(message.id);
                assert.deepEqual(delivery.recipientTo, latest.replyTo);
                assert.deepEqual(delivery.recipientCc, [
                    "second@example.test",
                    "manager@example.test",
                ]);
                assert.equal(delivery.inReplyTo, latest.rfcMessageId);
                const claim = await clients.dh.claimEmail(boxes.dh.id),
                    raw = Buffer.from(
                        gmailReplyRaw(claim),
                        "base64url",
                    ).toString();
                assert.deepEqual(claim.recipientTo, delivery.recipientTo);
                assert.ok(
                    raw.includes(
                        "To: reply@example.test,\r\n second-reply@example.test",
                    ),
                );
                assert.ok(
                    raw.includes(
                        "Cc: second@example.test,\r\n manager@example.test",
                    ),
                );
                assert.equal(raw.includes("Bcc:"), false);
                await clients.dh.changeEmailDelivery(claim.id, {
                    action: "prepare_failed",
                    leaseToken: claim.leaseToken,
                    errorCode: "mime_invalid",
                });
            },
        );
        await check(
            "동일 전송 재시도는 한 건·수신자 또는 회신 방식 변경은 충돌",
            async () => {
                const before = (await db.select().from(s.inboxEmailDeliveries))
                    .length;
                await reply(selected, replyId);
                assert.equal(
                    (await db.select().from(s.inboxEmailDeliveries)).length,
                    before,
                );
                await assert.rejects(
                    reply({ ...selected, mode: "reply" }, replyId),
                    (e) => e.status === 409,
                );
                await assert.rejects(
                    reply(
                        {
                            ...selected,
                            mode: "custom",
                            to: ["other@example.test"],
                        },
                        replyId,
                    ),
                    (e) => e.status === 409,
                );
            },
        );
        await check(
            "새 메일 도착 시 오래된 선택 저장 원자 거절·옛 재시도와 큐 대상 보존",
            async () => {
                const r = await clients.dh.receiveEmail(
                    boxes.dh.id,
                    inbound("dh", { from: "third@example.test", cc: [] }),
                );
                const before = (await db.select().from(s.inboxMessages)).length;
                await assert.rejects(reply(selected), (e) => e.status === 409);
                assert.equal(
                    (await db.select().from(s.inboxMessages)).length,
                    before,
                );
                await reply(selected, replyId);
                assert.deepEqual(
                    (await deliveryFor(delivery.messageId)).recipientCc,
                    delivery.recipientCc,
                );
                selected = { mode: "reply", sourceMessageId: r.messageId };
                const m = await reply(selected);
                assert.deepEqual((await deliveryFor(m.id)).recipientTo, [
                    "third@example.test",
                ]);
                assert.deepEqual((await deliveryFor(m.id)).recipientCc, []);
            },
        );
        await check(
            "직접 지정·삭제·To 우선 중복 정리·대소문자 재시도",
            async () => {
                const id = randomUUID(),
                    selection = {
                        ...selected,
                        mode: "custom",
                        to: ["ONLY@example.test", "only@example.test"],
                        cc: ["only@example.test", "NEW@example.test"],
                    },
                    m = await reply(selection, id);
                const d = await deliveryFor(m.id);
                assert.deepEqual(d.recipientTo, ["only@example.test"]);
                assert.deepEqual(d.recipientCc, ["new@example.test"]);
                await reply(
                    {
                        ...selection,
                        to: ["only@example.test"],
                        cc: ["new@example.test", "only@example.test"],
                    },
                    id,
                );
            },
        );
        await check(
            "잘못된 주소·자기 주소·숨은참조·30명 초과·일반 모드 주소 위조 거절",
            async () => {
                for (const selection of [
                    { ...selected, mode: "custom", to: [] },
                    { ...selected, mode: "custom", to: [boxes.dh.address] },
                    {
                        ...selected,
                        mode: "custom",
                        to: ["x@example.test\r\nBcc:y@example.test"],
                    },
                    {
                        ...selected,
                        mode: "custom",
                        to: Array.from(
                            { length: 30 },
                            (_, i) => `to${i}@example.test`,
                        ),
                        cc: ["cc@example.test"],
                    },
                    { ...selected, to: ["spoof@example.test"] },
                    { ...selected, bcc: ["bcc@example.test"] },
                ])
                    await assert.rejects(
                        reply(selection),
                        (e) => e.status === 400,
                    );
            },
        );
        await check("내부 메모·웹 상담에 이메일 대상 사용 차단", async () => {
            await assert.rejects(
                clients.dh.reply(
                    received.conversationId,
                    "메모",
                    randomUUID(),
                    "note",
                    [],
                    undefined,
                    selected,
                ),
                (e) => e.status === 400,
            );
            const chats = await clients.dh.conversations(channels.dh.id);
            const web = chats.find((c) => c.medium === "web");
            await assert.rejects(
                clients.dh.reply(
                    web.id,
                    "웹",
                    randomUUID(),
                    "reply",
                    [],
                    undefined,
                    selected,
                ),
                (e) => e.status === 400,
            );
        });
        await check("조직·사업·읽기 키 범위 격리", async () => {
            await assert.rejects(
                clients.bo.inboxConversation(received.conversationId),
                (e) => e.status === 403,
            );
            await assert.rejects(
                clients.read.reply(
                    received.conversationId,
                    "차단",
                    randomUUID(),
                    "reply",
                    [],
                    undefined,
                    selected,
                ),
                (e) => e.status === 403,
            );
            await assert.rejects(
                repo.conversationDetail(
                    otherActor,
                    received.conversationId,
                    db,
                ),
                (e) => e.status === 404,
            );
            const bo = await clients.bo.receiveEmail(
                boxes.bo.id,
                inbound("bo", { from: "bo@example.test" }),
            );
            assert.notEqual(bo.conversationId, received.conversationId);
            assert.notEqual(
                (await clients.bo.inboxConversation(bo.conversationId))
                    .conversation.contactId,
                contactId,
            );
        });
        await check(
            "늦게 들어온 과거 메일은 최신 대상·참조를 바꾸지 않음",
            async () => {
                const before = (await details()).conversation.emailContext;
                await clients.dh.receiveEmail(
                    boxes.dh.id,
                    inbound("dh", {
                        from: "old@example.test",
                        cc: ["old-cc@example.test"],
                        receivedAt: "2020-01-01T00:00:00Z",
                    }),
                );
                assert.deepEqual(
                    (await details()).conversation.emailContext,
                    before,
                );
            },
        );
        await check(
            "서로 다른 원본 번호·내용 충돌과 Reply-To 이전 fingerprint 호환",
            async () => {
                const legacy = inbound("dh", {
                        providerThreadId: "legacy-thread",
                    }),
                    r = await clients.dh.receiveEmail(boxes.dh.id, legacy);
                const res = await clients.dh.receiveEmail(boxes.dh.id, {
                    ...legacy,
                    replyTo: ["reply@example.test"],
                });
                assert.equal(res.duplicate, true);
                await assert.rejects(
                    clients.dh.receiveEmail(boxes.dh.id, {
                        ...legacy,
                        body: "변경",
                    }),
                    (e) => e.status === 409,
                );
                assert.ok(r.messageId);
            },
        );
        await check(
            "수신·전송 동시 처리에서 최신 대상 선택 일치 또는 409",
            async () => {
                const prev = (await details()).conversation.emailContext,
                    proposal = {
                        mode: "reply_all",
                        sourceMessageId: prev.sourceMessageId,
                    };
                const result = await Promise.allSettled([
                    reply(proposal),
                    clients.dh.receiveEmail(
                        boxes.dh.id,
                        inbound("dh", {
                            from: "race@example.test",
                            cc: ["race-cc@example.test"],
                        }),
                    ),
                ]);
                assert.equal(result[1].status, "fulfilled");
                if (result[0].status === "fulfilled") {
                    const row = await deliveryFor(result[0].value.id);
                    assert.deepEqual(row.recipientTo, prev.replyAllTo);
                    assert.deepEqual(row.recipientCc, prev.replyAllCc);
                } else assert.equal(result[0].reason.status, 409);
            },
        );
        await check(
            "대기 재시도는 새 문의의 수신자를 섞지 않고 원래 봉투 유지",
            async () => {
                const row = (
                    await db
                        .select()
                        .from(s.inboxEmailDeliveries)
                        .where(eq(s.inboxEmailDeliveries.id, delivery.id))
                )[0];
                assert.equal(row.state, "failed");
                await clients.dh.changeEmailDelivery(row.id, {
                    action: "retry",
                });
                const claim = await clients.dh.claimEmail(boxes.dh.id);
                assert.equal(claim.id, row.id);
                assert.deepEqual(claim.recipientTo, latest.replyTo);
                await clients.dh.changeEmailDelivery(claim.id, {
                    action: "cancel",
                });
            },
        );
        await check("Gmail Reply-To 파싱과 헤더 줄 접기 검증", async () => {
            const parsed = gmailInbound({
                id: "gmail",
                threadId: "thread",
                internalDate: String(Date.now()),
                payload: {
                    mimeType: "text/plain",
                    headers: [
                        { name: "From", value: "sender@example.test" },
                        { name: "To", value: boxes.dh.address },
                        {
                            name: "Reply-To",
                            value: "Sales <sales@example.test>, team@example.test",
                        },
                        { name: "Message-ID", value: "<gmail@example.test>" },
                    ],
                    body: { data: Buffer.from("가상").toString("base64url") },
                },
            });
            assert.deepEqual(parsed.replyTo, [
                "sales@example.test",
                "team@example.test",
            ]);
            const claim = {
                id: "test",
                recipient: "a@example.test",
                recipientTo: ["a@example.test"],
                recipientCc: ["b@example.test"],
                from: boxes.dh.address,
                fromName: "가상",
                rfcMessageId: "<test@example.test>",
                inReplyTo: "<source@example.test>",
                subject: "가상",
                body: "가상",
            };
            for (const change of [
                { recipientCc: ["b@example.test\r\nBcc:c@example.test"] },
                { recipientTo: [] },
                { recipientTo: ["other@example.test"] },
                { recipientCc: ["a@example.test"] },
            ])
                assert.throws(() => gmailReplyRaw({ ...claim, ...change }));
        });
        await check(
            "0104 기존 수신 대상·최신 원본 백필은 저장된 관계만 사용",
            async () => {
                await db
                    .update(s.inboxEmailThreads)
                    .set({ lastInboundMessageId: null })
                    .where(
                        eq(
                            s.inboxEmailThreads.conversationId,
                            received.conversationId,
                        ),
                    );
                await db
                    .update(s.inboxEmailDeliveries)
                    .set({ recipientTo: ["placeholder@example.test"] })
                    .where(eq(s.inboxEmailDeliveries.id, delivery.id));
                const sql = require("node:fs").readFileSync(
                    require("node:path").join(
                        __dirname,
                        "../drizzle/0104_email_reply_recipients.sql",
                    ),
                    "utf8",
                );
                await pg.exec(
                    sql.slice(
                        sql.indexOf("UPDATE inbox_email_deliveries"),
                        sql.indexOf(
                            "ALTER TABLE inbox_email_deliveries ADD CONSTRAINT",
                        ),
                    ),
                );
                const [row] = await db
                    .select()
                    .from(s.inboxEmailThreads)
                    .where(
                        eq(
                            s.inboxEmailThreads.conversationId,
                            received.conversationId,
                        ),
                    );
                const [receipt] = await db
                    .select()
                    .from(s.inboxEmailReceipts)
                    .where(
                        eq(
                            s.inboxEmailReceipts.messageId,
                            row.lastInboundMessageId,
                        ),
                    );
                assert.equal(receipt.mailboxId, boxes.dh.id);
                assert.equal(
                    receipt.envelope.rfcMessageId,
                    row.lastRfcMessageId,
                );
                const saved = await deliveryFor(delivery.messageId);
                assert.deepEqual(saved.recipientTo, [saved.recipient]);
            },
        );
        await check(
            "배포 중 이전 수신·발송 코드의 포인터/단일 수신자 호환",
            async () => {
                const before = (await details()).conversation.emailContext;
                await db
                    .update(s.inboxEmailThreads)
                    .set({ lastInboundMessageId: received.messageId })
                    .where(
                        eq(
                            s.inboxEmailThreads.conversationId,
                            received.conversationId,
                        ),
                    );
                assert.equal(
                    (await details()).conversation.emailContext.sourceMessageId,
                    before.sourceMessageId,
                );
                await db
                    .update(s.inboxEmailThreads)
                    .set({ lastInboundMessageId: null })
                    .where(
                        eq(
                            s.inboxEmailThreads.conversationId,
                            received.conversationId,
                        ),
                    );
                assert.equal(
                    (await details()).conversation.emailContext.sourceMessageId,
                    before.sourceMessageId,
                );
                const pending = (await db.select().from(s.inboxEmailDeliveries))
                    .filter((d) => d.state === "queued")
                    .sort((a, b) => a.messageId - b.messageId)[0];
                await db
                    .update(s.inboxEmailDeliveries)
                    .set({
                        recipientTo: null,
                        recipientCc: [],
                        replyMode: "reply",
                        requestFingerprint: null,
                    })
                    .where(eq(s.inboxEmailDeliveries.id, pending.id));
                const claim = await clients.dh.claimEmail(boxes.dh.id);
                assert.equal(claim.id, pending.id);
                assert.deepEqual(claim.recipientTo, [pending.recipient]);
                const message = (await details()).messages.find(
                    (m) => m.id === pending.messageId,
                );
                assert.deepEqual(message.delivery.recipientTo, [
                    pending.recipient,
                ]);
                await clients.dh.changeEmailDelivery(claim.id, {
                    action: "cancel",
                });
            },
        );
        console.log(
            `이메일 다중 참여자·회신 대상 SQL/API QA ${checks}개 통과 · 실제 외부 발송 0건`,
        );
        if (extra)
            return extra({
                ...ctx,
                emailMailboxes: boxes,
                emailConversation: received.conversationId,
            });
        await pg.close();
    });
}
if (require.main === module)
    runRecipientCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runRecipientCheck };
