/* eslint-disable @typescript-eslint/no-require-imports -- 가상 직원·격리 DB의 내부 메모 멘션 QA */
const assert = require("node:assert/strict"),
    { randomUUID, randomBytes } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function runMentionCheck(extra) {
    return runPlatformCheck(async (ctx) => {
        const {
                db,
                pg,
                actor,
                otherActor,
                clients,
                channels,
                contacts,
                repo,
                dispatch,
            } = ctx,
            s = require("../src/lib/db/schema.ts"),
            { eq, and } = require("drizzle-orm"),
            ops = require("../src/lib/inbox-operations/repository.ts"),
            { generateToken } = require("../src/lib/auth.ts");
        let checks = 0;
        const check = async (name, fn) => {
            await fn();
            console.log(`PASS MENTIONS ${++checks} ${name}`);
        };
        async function person(name, workspaceId, role = "viewer", active = 1) {
            const user = {
                ...actor,
                userId: randomUUID(),
                name,
                role: "member",
                email: randomUUID() + "@example.test",
            };
            await db.insert(s.users).values({
                id: user.userId,
                orgId: actor.orgId,
                name,
                email: user.email,
                password: "fake-only",
                isActive: active,
            });
            await db.insert(s.organizationMembers).values({
                organizationId: actor.orgId,
                userId: user.userId,
                role: "member",
            });
            if (workspaceId)
                await db.insert(s.customerWorkspaceAccess).values({
                    orgId: actor.orgId,
                    workspaceId,
                    userId: user.userId,
                    role,
                });
            return user;
        }
        const viewer = await person("가상 멘션 열람", 8),
            agent = await person("가상 멘션 응대", 8, "agent"),
            bo = await person("가상 백오랩 멘션", 10, "agent"),
            none = await person("가상 접근 없음", null),
            inactive = await person("가상 비활성", 8, "viewer", 0);
        const chat = (await clients.dh.conversations(channels.dh.id)).find(
                (c) => c.contactId === contacts.dh.id,
            ),
            peer = await repo.startVisitorSession(
                channels.bo.publicKey,
                { name: "가상 백오랩 검증 상담" },
                db,
            );
        const note = (
            ids = [viewer.userId],
            body = "가상 내부 검토 요청",
            id = randomUUID(),
        ) => clients.dh.note(chat.id, body, id, { mentionedUserIds: ids });
        const allNotices = () =>
            db
                .select()
                .from(s.inboxNotifications)
                .where(eq(s.inboxNotifications.type, "mentioned"));
        const page = (who = viewer, options = {}) =>
            ops.notificationsPage(who, options, db);
        async function native(who, path, body, expected = 200) {
            const response = await dispatch("http://127.0.0.1:3120" + path, {
                    method: body ? "POST" : "GET",
                    headers: {
                        Authorization: "Bearer " + generateToken(who),
                        "Content-Type": "application/json",
                    },
                    ...(body ? { body: JSON.stringify(body) } : {}),
                }),
                result = await response.json();
            assert.equal(response.status, expected, JSON.stringify(result));
            return result.data;
        }
        async function visitor(token, body, expected = 200) {
            const response = await dispatch(
                    `http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}`,
                    {
                        method: body ? "POST" : "GET",
                        headers: {
                            "Content-Type": "application/json",
                            ...(token
                                ? { Authorization: "Bearer " + token }
                                : {}),
                        },
                        ...(body ? { body: JSON.stringify(body) } : {}),
                    },
                ),
                result = await response.json();
            assert.equal(response.status, expected, JSON.stringify(result));
            return result.data;
        }
        let first,
            firstClient = randomUUID(),
            firstNotice;
        await check(
            "활성 사업 열람 팀원 후보·담당자 후보 구분과 API 키 범위",
            async () => {
                const people = await clients.dh.mentionTeammates(
                    channels.dh.id,
                );
                assert.ok(people.some((m) => m.id === viewer.userId));
                assert.ok(people.some((m) => m.id === agent.userId));
                for (const who of [bo, none, inactive, otherActor])
                    assert.equal(
                        people.some((m) => m.id === who.userId),
                        false,
                    );
                const boot = await native(actor, "/api/inbox");
                assert.ok(
                    boot.mentionMembers.some((m) => m.id === viewer.userId),
                );
                assert.equal(
                    boot.members.some((m) => m.id === viewer.userId),
                    false,
                );
                await assert.rejects(
                    clients.bo.mentionTeammates(channels.dh.id),
                    (e) => e.status === 403,
                );
            },
        );
        await check(
            "메모·멘션·대상별 알림 저장, 고객 통계·CRM·외부 이벤트 제외",
            async () => {
                const before = await repo.ownedConversation(actor, chat.id, db),
                    events = (await db.select().from(s.platformEvents)).length,
                    activities = (await db.select().from(s.crmActivities))
                        .length;
                first = await note(
                    [viewer.userId, agent.userId],
                    "가상 민감 내부 검토 요청",
                    firstClient,
                );
                assert.deepEqual(
                    new Set(first.mentions.map((m) => m.userId)),
                    new Set([viewer.userId, agent.userId]),
                );
                const notices = (await allNotices()).filter(
                    (n) => n.messageId === first.id,
                );
                assert.equal(notices.length, 2);
                assert.ok(notices.every((n) => n.customerSeq === null));
                firstNotice = notices.find((n) => n.userId === viewer.userId);
                const after = await repo.ownedConversation(actor, chat.id, db);
                assert.equal(after.customerSeq, before.customerSeq);
                assert.equal(after.preview, before.preview);
                assert.equal(
                    (await db.select().from(s.platformEvents)).length,
                    events,
                );
                assert.equal(
                    (await db.select().from(s.crmActivities)).length,
                    activities,
                );
            },
        );
        await check(
            "대상 순서 재시도는 한 건, 같은 번호의 대상·본문 변경은 충돌",
            async () => {
                const retried = await note(
                    [agent.userId, viewer.userId],
                    "가상 민감 내부 검토 요청",
                    firstClient,
                );
                assert.equal(retried.id, first.id);
                assert.equal(
                    (await allNotices()).filter((n) => n.messageId === first.id)
                        .length,
                    2,
                );
                await assert.rejects(
                    note(
                        [viewer.userId],
                        "가상 민감 내부 검토 요청",
                        firstClient,
                    ),
                    (e) => e.status === 409,
                );
                await assert.rejects(
                    note(
                        [viewer.userId, agent.userId],
                        "본문 변경",
                        firstClient,
                    ),
                    (e) => e.status === 409,
                );
            },
        );
        await check(
            "다른 사업·조직·접근 없음·비활성 대상은 메모 전체 롤백",
            async () => {
                for (const who of [
                    bo,
                    none,
                    inactive,
                    otherActor,
                    { userId: randomUUID() },
                ]) {
                    const id = randomUUID();
                    await assert.rejects(
                        note(
                            [viewer.userId, who.userId],
                            "거절해야 할 메모",
                            id,
                        ),
                        (e) => e.status === 409,
                    );
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(s.inboxMessages)
                                .where(eq(s.inboxMessages.clientId, id))
                        ).length,
                        0,
                    );
                }
            },
        );
        await check(
            "고객 답변의 멘션·중복/잘못된 ID·21명 초과 거절",
            async () => {
                const path = `/api/v1/inbox/conversations/${chat.id}`;
                for (const payload of [
                    { kind: "reply", mentionedUserIds: [viewer.userId] },
                    {
                        kind: "note",
                        mentionedUserIds: [viewer.userId, viewer.userId],
                    },
                    { kind: "note", mentionedUserIds: ["가상 직원"] },
                    {
                        kind: "note",
                        mentionedUserIds: Array.from({ length: 21 }, () =>
                            randomUUID(),
                        ),
                    },
                ])
                    await assert.rejects(
                        clients.dh.request(path, "POST", {
                            body: "거절",
                            clientId: randomUUID(),
                            ...payload,
                        }),
                        (e) => e.status === 400,
                    );
            },
        );
        await check("서비스 읽기 키와 열람 직원은 메모 작성 불가", async () => {
            await assert.rejects(
                clients.read.note(chat.id, "거절", randomUUID(), {
                    mentionedUserIds: [viewer.userId],
                }),
                (e) => e.status === 403,
            );
            await native(
                viewer,
                `/api/inbox/conversations/${chat.id}`,
                {
                    kind: "note",
                    body: "거절",
                    clientId: randomUUID(),
                    mentionedUserIds: [agent.userId],
                },
                403,
            );
        });
        await check(
            "공개 회원/익명 이력과 고객 파일에서 메모·멘션 비공개",
            async () => {
                const identity = await clients.dh.customerIdentity(
                        channels.dh.id,
                        contacts.dh.id,
                    ),
                    result = await visitor(identity.identityToken);
                assert.equal(
                    JSON.stringify(result).includes("가상 민감 내부 검토 요청"),
                    false,
                );
                assert.equal(
                    JSON.stringify(result).includes(viewer.userId),
                    false,
                );
                const count = (await allNotices()).length;
                await visitor(identity.identityToken, {
                    body: "가상 공개 문의",
                    clientId: randomUUID(),
                    mentionedUserIds: [viewer.userId],
                });
                assert.equal((await allNotices()).length, count);
            },
        );
        await check(
            "개인 멘션 읽음은 고객 상담 읽음과 분리·다른 사람 읽음 차단",
            async () => {
                await repo.markRead(viewer, chat.id, 9999, db);
                let result = await page();
                assert.equal(
                    result.rows.find((r) => r.id === firstNotice.id).readAt,
                    null,
                );
                assert.equal(
                    result.rows.find((r) => r.id === firstNotice.id).messageId,
                    first.id,
                );
                await assert.rejects(
                    ops.readNotifications(
                        agent,
                        { action: "read", ids: [firstNotice.id] },
                        undefined,
                        db,
                    ),
                    (e) => e.status === 404,
                );
                await ops.readNotifications(
                    viewer,
                    { action: "read", ids: [firstNotice.id] },
                    undefined,
                    db,
                );
                result = await page();
                assert.ok(
                    result.rows.find((r) => r.id === firstNotice.id).readAt,
                );
            },
        );
        await check(
            "메모 대상 이름은 저장 당시 값, 새로운 메모는 현재 이름",
            async () => {
                await db
                    .update(s.users)
                    .set({ name: "가상 변경된 열람 이름" })
                    .where(eq(s.users.id, viewer.userId));
                const old = (
                    await clients.dh.inboxConversation(chat.id)
                ).messages.find((m) => m.id === first.id);
                assert.equal(
                    old.mentions.find((m) => m.userId === viewer.userId).name,
                    viewer.name,
                );
                const next = await note();
                assert.equal(next.mentions[0].name, "가상 변경된 열람 이름");
            },
        );
        await check(
            "나를 멘션한 상담 필터·검색·집계는 사람별로 구분",
            async () => {
                const mine = await repo.conversationListPage(
                    viewer,
                    channels.dh.id,
                    { filter: "mentioned" },
                    undefined,
                    undefined,
                    db,
                );
                assert.ok(mine.rows.some((c) => c.id === chat.id));
                assert.equal(mine.counts.mentioned, 1);
                const owner = await clients.dh.conversations(channels.dh.id, {
                    filter: "mentioned",
                });
                assert.equal(owner.length, 0);
                const searched = await repo.conversationListPage(
                    viewer,
                    channels.dh.id,
                    { filter: "mentioned", q: "가상 민감 내부 검토 요청" },
                    undefined,
                    undefined,
                    db,
                );
                assert.equal(searched.rows.length, 1);
            },
        );
        await check(
            "오래된 메모도 원문·작성자·멘션을 직접 열고 다른 상담/공개 메시지는 차단",
            async () => {
                await db.insert(s.inboxMessages).values(
                    Array.from({ length: 110 }, (_, i) => ({
                        conversationId: chat.id,
                        clientId: randomUUID(),
                        kind: "reply",
                        body: "가상 후속 공개 대화 " + i,
                        authorId: actor.userId,
                        authorName: actor.name,
                    })),
                );
                const current = await clients.dh.inboxConversation(chat.id);
                assert.equal(
                    current.messages.some((m) => m.id === first.id),
                    false,
                );
                const focused = await clients.dh.inboxConversation(
                    chat.id,
                    undefined,
                    first.id,
                );
                assert.equal(focused.focusedMessage.id, first.id);
                assert.equal(focused.focusedMessage.mentions.length, 2);
                const publicId = current.messages.at(-1).id;
                await assert.rejects(
                    clients.dh.inboxConversation(chat.id, undefined, publicId),
                    (e) => e.status === 404,
                );
                await assert.rejects(
                    clients.bo.inboxConversation(peer.id, undefined, first.id),
                    (e) => e.status === 404,
                );
                await assert.rejects(
                    clients.dh.inboxConversation(chat.id, undefined, -1),
                    (e) => e.status === 400,
                );
            },
        );
        await check(
            "알림 저장 실패 시 메모·첨부 연결·멘션 모두 롤백",
            async () => {
                const file = await clients.dh.uploadAttachment(
                        chat.id,
                        new Blob([Buffer.from("가상 메모 파일")], {
                            type: "text/plain",
                        }),
                        "note.txt",
                        randomUUID(),
                        "note",
                    ),
                    id = randomUUID();
                await pg.exec(
                    "CREATE FUNCTION qa_mention_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='mentioned' THEN RAISE EXCEPTION 'QA rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_mention_fail BEFORE INSERT ON inbox_notifications FOR EACH ROW EXECUTE FUNCTION qa_mention_fail();",
                );
                try {
                    await assert.rejects(
                        clients.dh.note(chat.id, "롤백", id, {
                            attachmentIds: [file.id],
                            mentionedUserIds: [viewer.userId],
                        }),
                    );
                } finally {
                    await pg.exec(
                        "DROP TRIGGER qa_mention_fail ON inbox_notifications; DROP FUNCTION qa_mention_fail();",
                    );
                }
                assert.equal(
                    (
                        await db
                            .select()
                            .from(s.inboxMessages)
                            .where(eq(s.inboxMessages.clientId, id))
                    ).length,
                    0,
                );
                const [saved] = await db
                    .select()
                    .from(s.inboxAttachments)
                    .where(eq(s.inboxAttachments.id, file.id));
                assert.equal(saved.messageId, null);
            },
        );
        await check(
            "내부 고객 상담의 직접 멘션은 보이고 고객 성과 알림과 분리",
            async () => {
                await db
                    .update(s.crmContacts)
                    .set({ isInternal: true })
                    .where(eq(s.crmContacts.id, contacts.dh.id));
                const m = await note();
                assert.ok(
                    (await page()).rows.some((r) => r.messageId === m.id),
                );
            },
        );
        await check(
            "비회원→회원 병합에서 멘션·미확인 알림·원문 링크 유지",
            async () => {
                const anon = await visitor(null, {
                    action: "session",
                    name: "가상 멘션 비회원",
                });
                await visitor(anon.token, {
                    body: "가상 비회원 문의",
                    clientId: randomUUID(),
                });
                const m = await clients.dh.note(
                    anon.id,
                    "로그인 전 내부 검토",
                    randomUUID(),
                    { mentionedUserIds: [viewer.userId] },
                );
                const notice = (await allNotices()).find(
                        (n) => n.messageId === m.id,
                    ),
                    identity = await clients.dh.customerIdentity(
                        channels.dh.id,
                        contacts.dh.id,
                    );
                await visitor(identity.identityToken, {
                    action: "identify",
                    anonymousToken: anon.token,
                });
                const [link] = await db
                    .select()
                    .from(s.inboxMessageMentions)
                    .where(eq(s.inboxMessageMentions.messageId, m.id));
                assert.equal(link.conversationId, chat.id);
                const moved = (await page()).rows.find(
                    (r) => r.id === notice.id,
                );
                assert.equal(moved.conversationId, chat.id);
                assert.equal(moved.readAt, null);
                const focused = await clients.dh.inboxConversation(
                    anon.id,
                    undefined,
                    m.id,
                );
                assert.equal(focused.conversation.id, chat.id);
                assert.equal(
                    focused.focusedMessage.body,
                    "로그인 전 내부 검토",
                );
                await db
                    .update(s.crmContacts)
                    .set({ isInternal: false })
                    .where(eq(s.crmContacts.id, contacts.dh.id));
            },
        );
        await check(
            "사업 권한 회수·비활성화 후 알림과 후보 제거, 옛 재시도 추가 알림 없음",
            async () => {
                await db
                    .update(s.customerWorkspaceAccess)
                    .set({ role: "none" })
                    .where(eq(s.customerWorkspaceAccess.userId, viewer.userId));
                assert.equal((await page()).rows.length, 0);
                assert.equal((await page()).unread, 0);
                assert.equal(
                    (await clients.dh.mentionTeammates(channels.dh.id)).some(
                        (m) => m.id === viewer.userId,
                    ),
                    false,
                );
                await assert.rejects(note(), (e) => e.status === 409);
                const count = (await allNotices()).length;
                assert.equal(
                    (
                        await note(
                            [viewer.userId, agent.userId],
                            "가상 민감 내부 검토 요청",
                            firstClient,
                        )
                    ).id,
                    first.id,
                );
                assert.equal((await allNotices()).length, count);
                await db
                    .update(s.customerWorkspaceAccess)
                    .set({ role: "viewer" })
                    .where(eq(s.customerWorkspaceAccess.userId, viewer.userId));
                await db
                    .update(s.users)
                    .set({ isActive: 0 })
                    .where(eq(s.users.id, viewer.userId));
                await assert.rejects(note(), (e) => e.status === 409);
                await db
                    .update(s.users)
                    .set({ isActive: 1 })
                    .where(eq(s.users.id, viewer.userId));
            },
        );
        await check(
            "이메일 내부 메모 멘션은 메일 발송 대기열을 만들지 않음",
            async () => {
                let box = await clients.bo.createEmailMailbox({
                    workspaceId: 10,
                    address: "mention-bo@example.test",
                    name: "가상 멘션 메일",
                });
                box = await clients.bo.changeEmailMailbox(
                    box.id,
                    box.version,
                    true,
                );
                const r = await clients.bo.receiveEmail(box.id, {
                    providerMessageId: "mention-mail",
                    providerThreadId: "mention-thread",
                    rfcMessageId: "<mention-mail@example.test>",
                    from: "customer@example.test",
                    to: [box.address],
                    subject: "가상",
                    body: "가상 문의",
                    receivedAt: new Date().toISOString(),
                });
                const before = (await db.select().from(s.inboxEmailDeliveries))
                        .length,
                    m = await clients.bo.note(
                        r.conversationId,
                        "백오랩 내부 확인",
                        randomUUID(),
                        { mentionedUserIds: [bo.userId] },
                    );
                assert.equal(
                    (await db.select().from(s.inboxEmailDeliveries)).length,
                    before,
                );
                assert.ok(
                    (await page(bo)).rows.some((n) => n.messageId === m.id),
                );
            },
        );
        await check("한 메모 20명과 자기 멘션 지원", async () => {
            const people = [];
            for (let i = 0; i < 20; i++)
                people.push(await person("가상 멘션 한도 " + i, 8));
            const m = await note(people.map((p) => p.userId));
            assert.equal(m.mentions.length, 20);
            assert.equal(
                (await allNotices()).filter((n) => n.messageId === m.id).length,
                20,
            );
            const self = await note([actor.userId], "가상 자기 멘션");
            assert.ok(
                (await page(actor)).rows.some((n) => n.messageId === self.id),
            );
        });
        await check(
            "같은 시각 50건 초과 알림의 커서·다른 사람 커서 차단",
            async () => {
                for (let i = 0; i < 55; i++)
                    await note([viewer.userId], "가상 알림 페이지 " + i);
                await db
                    .update(s.inboxNotifications)
                    .set({ createdAt: new Date("2025-01-01") })
                    .where(
                        and(
                            eq(s.inboxNotifications.type, "mentioned"),
                            eq(s.inboxNotifications.userId, viewer.userId),
                        ),
                    );
                const firstPage = await page(viewer, {
                    channelId: channels.dh.id,
                });
                assert.equal(firstPage.rows.length, 50);
                assert.equal(firstPage.hasMore, true);
                const second = await page(viewer, {
                    channelId: channels.dh.id,
                    before: firstPage.rows.at(-1).id,
                });
                const all = [...firstPage.rows, ...second.rows];
                assert.equal(new Set(all.map((r) => r.id)).size, all.length);
                assert.ok(all.length >= 55);
                await assert.rejects(
                    page(agent, { before: firstPage.rows.at(-1).id }),
                    (e) => e.status === 404,
                );
            },
        );
        await check(
            "100건 밖 멘션 상담도 서버 전체 필터·커서·집계에 포함",
            async () => {
                const chats = await db
                    .insert(s.inboxConversations)
                    .values(
                        Array.from({ length: 101 }, (_, i) => ({
                            orgId: actor.orgId,
                            channelId: channels.dh.id,
                            tokenHash: randomBytes(32).toString("hex"),
                            name: "가상 멘션 목록 " + i,
                            lastMessageAt: new Date("2020-01-01"),
                        })),
                    )
                    .returning();
                const messages = await db
                    .insert(s.inboxMessages)
                    .values(
                        chats.map((c) => ({
                            conversationId: c.id,
                            clientId: randomUUID(),
                            kind: "note",
                            body: "가상 멘션 목록 메모",
                            authorId: actor.userId,
                            authorName: actor.name,
                        })),
                    )
                    .returning();
                await db.insert(s.inboxMessageMentions).values(
                    messages.map((m) => ({
                        messageId: m.id,
                        userId: viewer.userId,
                        orgId: actor.orgId,
                        channelId: channels.dh.id,
                        conversationId: m.conversationId,
                        name: viewer.name,
                    })),
                );
                const firstPage = await repo.conversationListPage(
                        viewer,
                        channels.dh.id,
                        { filter: "mentioned", q: "가상 멘션 목록" },
                        undefined,
                        undefined,
                        db,
                    ),
                    last = firstPage.rows.at(-1);
                assert.equal(firstPage.rows.length, 100);
                assert.equal(firstPage.counts.mentioned, 101);
                const second = await repo.conversationListPage(
                    viewer,
                    channels.dh.id,
                    { filter: "mentioned", q: "가상 멘션 목록" },
                    new Date(last.lastMessageAt),
                    last.id,
                    db,
                );
                assert.equal(second.rows.length, 1);
                assert.equal(
                    new Set(
                        [...firstPage.rows, ...second.rows].map((c) => c.id),
                    ).size,
                    101,
                );
            },
        );
        console.log(
            `내부 메모 멘션 SQL/API QA ${checks}개 통과 · 실제 고객/외부 전송 0건`,
        );
        if (extra)
            return extra({
                ...ctx,
                mentionPeople: { viewer, agent, bo },
                mentionFirst: first,
            });
        await pg.close();
    });
}
if (require.main === module)
    runMentionCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runMentionCheck };
