/* eslint-disable @typescript-eslint/no-require-imports -- 가상 직원·상담·이메일의 답변 잠금/전송 경쟁 QA */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function scenario(ctx, real = false) {
    const { db, pg, actor, channels, clients, repo, dispatch, contacts } = ctx,
        s = require("../src/lib/db/schema.ts"),
        { eq, sql } = require("drizzle-orm");
    const guard = require("../src/lib/inbox-reply-guard/repository.ts"),
        { generateToken } = require("../src/lib/auth.ts");
    let count = 0;
    const check = async (name, fn) => {
        await fn();
        console.log(
            `PASS REPLY GUARD ${real ? "PG" : "SQL"} ${++count} ${name}`,
        );
    };
    const b = {
            ...actor,
            userId: randomUUID(),
            name: "가상 답변 담당 B",
            role: "member",
        },
        viewer = {
            ...actor,
            userId: randomUUID(),
            name: "가상 답변 열람",
            role: "member",
        };
    for (const [who, role] of [
        [b, "agent"],
        [viewer, "viewer"],
    ]) {
        await db.insert(s.users).values({
            id: who.userId,
            orgId: actor.orgId,
            name: who.name,
            email: who.userId + "@example.test",
            password: "fake-only",
        });
        await db.insert(s.organizationMembers).values({
            organizationId: actor.orgId,
            userId: who.userId,
            role: "member",
        });
        await db.insert(s.customerWorkspaceAccess).values({
            orgId: actor.orgId,
            workspaceId: 8,
            userId: who.userId,
            role,
        });
    }
    const chat = async (id) =>
        (await repo.conversationDetail(actor, id, db)).conversation;
    const visitor = async (channel = channels.dh) => {
        const v = await repo.startVisitorSession(
            channel.publicKey,
            { name: "가상 답변 잠금 문의" },
            db,
        );
        await repo.sendVisitorMessage(
            channel.publicKey,
            v.token,
            { clientId: randomUUID(), body: "가상 답변 잠금 문의" },
            db,
        );
        return v;
    };
    const setting = async (
        enabled,
        channel = channels.dh,
        client = clients.dh,
    ) => {
        const d = await client.replyGuard(channel.id);
        return client.saveReplyGuard({
            channelId: channel.id,
            version: d.version,
            enabled,
        });
    };
    const call = async (
        who,
        method,
        input,
        status = 200,
        path = "/api/inbox-reply-guard",
    ) => {
        const r = await dispatch("http://127.0.0.1:3120" + path, {
            method,
            headers: {
                authorization:
                    "Bearer " +
                    generateToken({ ...who, email: "qa@example.test" }),
                "content-type": "application/json",
            },
            ...(input ? { body: JSON.stringify(input) } : {}),
        });
        if (r.status !== status) {
            const error = new Error(
                `예상 HTTP ${status}, 실제 ${r.status}: ` +
                    (await r.clone().text()),
            );
            error.status = r.status;
            throw error;
        }
        return (await r.json()).data;
    };
    const acquire = async (
        id,
        who = actor,
        sessionId = randomUUID(),
        takeover,
    ) => {
        const page = await call(who, "POST", {
            action: "acquire",
            conversationId: id,
            sessionId,
            revision: (await chat(id)).replyRevision,
            ...(takeover ? { takeover } : {}),
        });
        return {
            page,
            context: {
                sessionId,
                leaseId: page.conversation.lease.id,
                revision: page.conversation.lease.baseRevision,
            },
        };
    };
    const send = (
        id,
        context,
        body = "가상 잠금 답변",
        who = actor,
        clientId = randomUUID(),
    ) =>
        repo.sendAgentMessage(
            who,
            id,
            {
                clientId,
                body,
                kind: "reply",
                ...(context ? { replyGuard: context } : {}),
            },
            db,
        );
    const renew = (id, context, who = actor, action = "renew", revision) =>
        call(who, "POST", {
            action,
            conversationId: id,
            sessionId: context.sessionId,
            leaseId: context.leaseId,
            ...(action === "acknowledge" ? { revision } : {}),
        });
    const release = (id, context, who = actor) =>
        renew(id, context, who, "release");
    const messages = async (id) =>
        db
            .select()
            .from(s.inboxMessages)
            .where(eq(s.inboxMessages.conversationId, id));
    await check(
        "기본 꺼짐·기존 SDK 답변 호환·공개 대화만 변경 순번 증가",
        async () => {
            assert.equal(
                (await clients.dh.replyGuard(channels.dh.id)).enabled,
                false,
            );
            const v = await visitor(),
                before = (await chat(v.id)).replyRevision;
            await clients.dh.reply(v.id, "가상 기존 SDK", randomUUID());
            assert.equal((await chat(v.id)).replyRevision, before + 1);
            await clients.dh.reply(
                v.id,
                "가상 내부 메모",
                randomUUID(),
                "note",
            );
            assert.equal((await chat(v.id)).replyRevision, before + 1);
        },
    );
    await check("설정 native/서비스 키·현재 관리 권한·사업 경계", async () => {
        await call(
            b,
            "PATCH",
            { channelId: channels.dh.id, version: 0, enabled: true },
            403,
        );
        await assert.rejects(
            () =>
                clients.read.saveReplyGuard({
                    channelId: channels.dh.id,
                    version: 0,
                    enabled: true,
                }),
            (e) => e.status === 403,
        );
        await assert.rejects(
            () => clients.bo.replyGuard(channels.dh.id),
            (e) => e.status === 403,
        );
        assert.equal(
            (
                await call(
                    viewer,
                    "GET",
                    null,
                    200,
                    "/api/inbox-reply-guard?channelId=" + channels.dh.id,
                )
            ).canManage,
            false,
        );
    });
    await check(
        "설정 CAS·멱등·사업 독립·기존 상담창 저장 시 옵션 보존",
        async () => {
            const enabled = await setting(true);
            assert.equal(enabled.version, 1);
            assert.equal((await setting(true)).version, 1);
            await call(
                actor,
                "PATCH",
                { channelId: channels.dh.id, version: 0, enabled: false },
                409,
            );
            const ch = (await repo.bootstrapInbox(actor, db)).channels.find(
                (c) => c.id === channels.dh.id,
            );
            await repo.saveChannel(
                actor,
                {
                    workspaceId: 8,
                    name: ch.name,
                    greeting: ch.greeting,
                    color: ch.color,
                    allowedOrigins: ch.allowedOrigins,
                    enabled: ch.enabled,
                },
                db,
            );
            assert.equal((await clients.dh.replyGuard(ch.id)).enabled, true);
            assert.equal(
                (await clients.bo.replyGuard(channels.bo.id)).enabled,
                false,
            );
        },
    );
    await check(
        "잠금 사용 사업의 직원 답변은 서버에서 권한 없는 전송 거절",
        async () => {
            const v = await visitor(),
                before = (await messages(v.id)).length;
            await assert.rejects(
                () => clients.dh.reply(v.id, "가상 차단", randomUUID()),
                (e) => e.status === 409,
            );
            assert.equal((await messages(v.id)).length, before);
            const revision = (await chat(v.id)).replyRevision;
            await assert.rejects(
                () =>
                    send(v.id, {
                        sessionId: randomUUID(),
                        leaseId: randomUUID(),
                        revision,
                    }),
                (e) => e.status === 409,
            );
        },
    );
    await check(
        "SDK 작성 시작·동일 요청 멱등·이 창만 소유·다른 탭/직원 충돌",
        async () => {
            const v = await visitor(),
                sessionId = randomUUID(),
                revision = (await chat(v.id)).replyRevision;
            const first = await clients.dh.updateReplyLease({
                action: "acquire",
                conversationId: v.id,
                sessionId,
                revision,
            });
            assert.equal(first.conversation.lease.isMine, true);
            const same = await clients.dh.updateReplyLease({
                action: "acquire",
                conversationId: v.id,
                sessionId,
                revision,
            });
            assert.equal(
                same.conversation.lease.id,
                first.conversation.lease.id,
            );
            const other = await guard.replyGuardPage(
                b,
                channels.dh.id,
                v.id,
                randomUUID(),
                db,
            );
            assert.equal(other.conversation.lease.isMine, false);
            assert.equal("sessionId" in other.conversation.lease, false);
            await assert.rejects(
                () => acquire(v.id, b),
                (e) => e.status === 409,
            );
            await assert.rejects(
                () => acquire(v.id, actor),
                (e) => e.status === 409,
            );
            await call(
                viewer,
                "POST",
                {
                    action: "acquire",
                    conversationId: v.id,
                    sessionId: randomUUID(),
                    revision,
                },
                403,
            );
            await release(v.id, {
                sessionId,
                leaseId: first.conversation.lease.id,
            });
        },
    );
    await check(
        "확인된 답변은 한 번 저장·잠금 해제·응답 유실 재시도 멱등",
        async () => {
            const v = await visitor(),
                a = await acquire(v.id),
                clientId = randomUUID(),
                before = (await chat(v.id)).replyRevision;
            const sent = await clients.dh.reply(
                v.id,
                "가상 한 번 답변",
                clientId,
                "reply",
                [],
                undefined,
                undefined,
                a.context,
            );
            assert.equal((await chat(v.id)).replyRevision, before + 1);
            assert.equal(
                (
                    await clients.dh.replyGuard(
                        channels.dh.id,
                        v.id,
                        a.context.sessionId,
                    )
                ).conversation.lease,
                null,
            );
            const again = await clients.dh.reply(
                v.id,
                "가상 한 번 답변",
                clientId,
                "reply",
                [],
                undefined,
                undefined,
                a.context,
            );
            assert.equal(again.id, sent.id);
            assert.equal(
                (await messages(v.id)).filter((m) => m.kind === "reply").length,
                1,
            );
            await assert.rejects(
                () =>
                    clients.dh.reply(
                        v.id,
                        "가상 바뀐 문장",
                        clientId,
                        "reply",
                        [],
                        undefined,
                        undefined,
                        a.context,
                    ),
                (e) => e.status === 409,
            );
        },
    );
    await check(
        "새 고객 메시지는 초안 기준을 무효화·갱신은 자동 승인하지 않음",
        async () => {
            const v = await visitor(),
                a = await acquire(v.id);
            await repo.sendVisitorMessage(
                channels.dh.publicKey,
                v.token,
                { clientId: randomUUID(), body: "가상 새 조건 추가" },
                db,
            );
            const live = await renew(v.id, a.context);
            assert.equal(
                live.conversation.lease.baseRevision,
                a.context.revision,
            );
            assert.notEqual(live.conversation.revision, a.context.revision);
            await assert.rejects(
                () => send(v.id, a.context),
                (e) => e.status === 409,
            );
            await call(
                actor,
                "POST",
                {
                    action: "acknowledge",
                    conversationId: v.id,
                    ...a.context,
                    unexpected: true,
                },
                400,
            );
            await call(
                actor,
                "POST",
                {
                    action: "acknowledge",
                    conversationId: v.id,
                    sessionId: a.context.sessionId,
                    leaseId: a.context.leaseId,
                    revision: a.context.revision,
                },
                409,
            );
            const reviewed = await renew(
                v.id,
                a.context,
                actor,
                "acknowledge",
                (await chat(v.id)).replyRevision,
            );
            await send(v.id, {
                ...a.context,
                revision: reviewed.conversation.lease.baseRevision,
            });
        },
    );
    await check(
        "다른 직원 내부 메모는 작성 가능·공개 순번/작성 권한 보존",
        async () => {
            const v = await visitor(),
                a = await acquire(v.id);
            await repo.sendAgentMessage(
                b,
                v.id,
                {
                    clientId: randomUUID(),
                    body: "가상 팀 내부 협의",
                    kind: "note",
                },
                db,
            );
            assert.equal((await chat(v.id)).replyRevision, a.context.revision);
            await send(v.id, a.context);
            await call(
                actor,
                "POST",
                {
                    kind: "note",
                    body: "가상 잘못된 잠금 메모",
                    clientId: randomUUID(),
                    replyGuard: a.context,
                },
                400,
                "/api/inbox/conversations/" + v.id,
            );
        },
    );
    await check(
        "만료 복구·지연된 옛 갱신/해제는 새 작성 권한을 바꾸지 못함",
        async () => {
            const v = await visitor(),
                a = await acquire(v.id);
            await db
                .update(s.inboxReplyLeases)
                .set({ expiresAt: new Date(Date.now() - 1000) })
                .where(eq(s.inboxReplyLeases.conversationId, v.id));
            const next = await acquire(v.id, b);
            assert.notEqual(next.context.leaseId, a.context.leaseId);
            await call(
                actor,
                "POST",
                {
                    action: "renew",
                    conversationId: v.id,
                    sessionId: a.context.sessionId,
                    leaseId: a.context.leaseId,
                },
                409,
            );
            await release(v.id, a.context);
            assert.equal(
                (
                    await guard.replyGuardPage(
                        b,
                        channels.dh.id,
                        v.id,
                        next.context.sessionId,
                        db,
                    )
                ).conversation.lease.id,
                next.context.leaseId,
            );
            await assert.rejects(
                () => send(v.id, a.context),
                (e) => e.status === 409,
            );
            await release(v.id, next.context, b);
        },
    );
    await check(
        "관리자 인계의 사유/현재 권한 CAS·옛 창 전송 차단·감사",
        async () => {
            const v = await visitor(),
                holder = await acquire(v.id, b),
                observed = {
                    leaseId: holder.context.leaseId,
                    reason: "가상 고객 요청으로 인계",
                };
            await call(
                b,
                "POST",
                {
                    action: "acquire",
                    conversationId: v.id,
                    sessionId: randomUUID(),
                    revision: (await chat(v.id)).replyRevision,
                    takeover: observed,
                },
                403,
            );
            await call(
                actor,
                "POST",
                {
                    action: "acquire",
                    conversationId: v.id,
                    sessionId: randomUUID(),
                    revision: (await chat(v.id)).replyRevision,
                    takeover: { ...observed, reason: "x" },
                },
                400,
            );
            await call(
                actor,
                "POST",
                {
                    action: "acquire",
                    conversationId: v.id,
                    sessionId: randomUUID(),
                    revision: (await chat(v.id)).replyRevision,
                    takeover: { ...observed, leaseId: randomUUID() },
                },
                409,
            );
            const next = await acquire(v.id, actor, randomUUID(), observed);
            await assert.rejects(
                () => send(v.id, holder.context, "가상 옛 창 답변", b),
                (e) => e.status === 409,
            );
            await send(v.id, next.context);
            const audits = await db
                .select()
                .from(s.inboxAuditEvents)
                .where(eq(s.inboxAuditEvents.action, "reply_guard.taken_over"));
            assert.ok(
                audits.some(
                    (a) =>
                        a.changes.handoffReason.after === observed.reason &&
                        a.changes.replyWriter.beforeLabel === b.name,
                ),
            );
        },
    );
    await check(
        "직원 응대 권한 회수 시 잠금 해제 가능·옛 직원 전송 거절",
        async () => {
            const v = await visitor(),
                old = await acquire(v.id, b);
            await db
                .update(s.customerWorkspaceAccess)
                .set({ role: "viewer" })
                .where(eq(s.customerWorkspaceAccess.userId, b.userId));
            const next = await acquire(v.id);
            assert.notEqual(next.context.leaseId, old.context.leaseId);
            await assert.rejects(
                () => send(v.id, old.context, "가상 회수 직원", b),
                (e) => e.status === 403,
            );
            await db
                .update(s.customerWorkspaceAccess)
                .set({ role: "agent" })
                .where(eq(s.customerWorkspaceAccess.userId, b.userId));
            await release(v.id, next.context);
        },
    );
    await check(
        "사용 설정을 껐다 켜면 옛 작성 권한은 재사용하지 못함",
        async () => {
            const v = await visitor(),
                old = await acquire(v.id);
            await setting(false);
            await send(v.id, undefined, "가상 잠금 해제 후 답변");
            await setting(true);
            await assert.rejects(
                () => send(v.id, old.context),
                (e) => e.status === 409,
            );
            const next = await acquire(v.id);
            assert.notEqual(next.context.leaseId, old.context.leaseId);
            await release(v.id, next.context);
        },
    );
    await check(
        "감사 INSERT 실패는 작성 권한과 설정 변경까지 롤백",
        async () => {
            const v = await visitor(),
                before = await clients.dh.replyGuard(channels.dh.id);
            await pg.exec(
                "ALTER TABLE inbox_audit_events ADD CONSTRAINT qa_guard_audit_failure CHECK (action NOT LIKE 'reply_guard.%') NOT VALID",
            );
            try {
                await call(
                    actor,
                    "POST",
                    {
                        action: "acquire",
                        conversationId: v.id,
                        sessionId: randomUUID(),
                        revision: (await chat(v.id)).replyRevision,
                    },
                    500,
                );
                await call(
                    actor,
                    "PATCH",
                    {
                        channelId: channels.dh.id,
                        version: before.version,
                        enabled: false,
                    },
                    500,
                );
            } finally {
                await pg.exec(
                    "ALTER TABLE inbox_audit_events DROP CONSTRAINT qa_guard_audit_failure",
                );
            }
            assert.equal(
                (await clients.dh.replyGuard(channels.dh.id, v.id)).conversation
                    .lease,
                null,
            );
            assert.equal(
                (await clients.dh.replyGuard(channels.dh.id)).version,
                before.version,
            );
        },
    );
    await check(
        "메시지 저장 실패는 잠금 소비/순번도 롤백·동일 ID 재시도",
        async () => {
            const v = await visitor(),
                a = await acquire(v.id),
                clientId = randomUUID();
            await pg.exec(
                "ALTER TABLE inbox_messages ADD CONSTRAINT qa_guard_message_failure CHECK (body <> 'guard-failure') NOT VALID",
            );
            try {
                await assert.rejects(() =>
                    send(v.id, a.context, "guard-failure", actor, clientId),
                );
            } finally {
                await pg.exec(
                    "ALTER TABLE inbox_messages DROP CONSTRAINT qa_guard_message_failure",
                );
            }
            assert.equal(
                (
                    await clients.dh.replyGuard(
                        channels.dh.id,
                        v.id,
                        a.context.sessionId,
                    )
                ).conversation.lease.id,
                a.context.leaseId,
            );
            assert.equal((await chat(v.id)).replyRevision, a.context.revision);
            await send(v.id, a.context, "guard-failure", actor, clientId);
            assert.equal(
                (await messages(v.id)).filter((m) => m.kind === "reply").length,
                1,
            );
        },
    );
    await check(
        "상담원 작성 중 자동 공개 답변 보류·해제 후 기존 자동 경로 허용",
        async () => {
            const v = await visitor(),
                a = await acquire(v.id);
            await assert.rejects(
                () =>
                    repo.sendSystemReply(
                        db,
                        v.id,
                        "가상 자동 답변",
                        randomUUID(),
                    ),
                (e) => e.status === 409,
            );
            await release(v.id, a.context);
            await repo.sendSystemReply(
                db,
                v.id,
                "가상 자동 답변",
                randomUUID(),
            );
            assert.equal(
                (await chat(v.id)).replyRevision,
                a.context.revision + 1,
            );
        },
    );
    await check(
        "종료·과거·병합 원본에는 새 작성 권한을 만들지 않음",
        async () => {
            const closed = await visitor();
            await repo.patchConversation(
                actor,
                closed.id,
                { version: (await chat(closed.id)).version, status: "closed" },
                db,
            );
            await assert.rejects(
                () => acquire(closed.id),
                (e) => e.status === 409,
            );
            const old = await visitor();
            await db
                .update(s.inboxConversations)
                .set({ historyOnly: true })
                .where(eq(s.inboxConversations.id, old.id));
            await assert.rejects(
                () => acquire(old.id),
                (e) => e.status === 409,
            );
            const target = await visitor(),
                source = await visitor();
            await db
                .update(s.inboxConversations)
                .set({ mergedIntoId: target.id })
                .where(eq(s.inboxConversations.id, source.id));
            await assert.rejects(
                () =>
                    guard.updateReplyLease(
                        actor,
                        {
                            action: "acquire",
                            conversationId: source.id,
                            sessionId: randomUUID(),
                            revision: 1,
                        },
                        db,
                    ),
                (e) => e.status === 404,
            );
        },
    );
    await check(
        "백오랩 독립 설정·다른 상담의 작성 권한 재사용 거절",
        async () => {
            await setting(true, channels.bo, clients.bo);
            const bo = await visitor(channels.bo),
                dh = await visitor(),
                a = await acquire(dh.id);
            await assert.rejects(
                () =>
                    clients.bo.reply(
                        bo.id,
                        "가상 다른 상담 토큰",
                        randomUUID(),
                        "reply",
                        [],
                        undefined,
                        undefined,
                        a.context,
                    ),
                (e) => e.status === 409,
            );
            await assert.rejects(
                () => clients.dh.replyGuard(channels.bo.id, bo.id),
                (e) => e.status === 403,
            );
            const current = await clients.bo.updateReplyLease({
                action: "acquire",
                conversationId: bo.id,
                sessionId: randomUUID(),
                revision: (await chat(bo.id)).replyRevision,
            });
            assert.equal(current.conversation.lease.userId, actor.userId);
            await release(dh.id, a.context);
        },
    );
    await check(
        "이메일 답장도 같은 잠금 적용·발송 큐 한 건/중복 없음",
        async () => {
            let box = await clients.dh.createEmailMailbox({
                workspaceId: 8,
                address: "guard@example.test",
                name: "가상 잠금 메일",
            });
            box = await clients.dh.changeEmailMailbox(
                box.id,
                box.version,
                true,
            );
            const received = await clients.dh.receiveEmail(box.id, {
                providerMessageId: "guard-in-1",
                providerThreadId: "guard-thread",
                rfcMessageId: "<guard-in-1@example.test>",
                from: "guard-lead@example.test",
                to: [box.address],
                subject: "가상 잠금 이메일",
                body: "가상 이메일 문의",
                receivedAt: new Date().toISOString(),
            });
            const id = received.conversationId;
            await assert.rejects(
                () => clients.dh.reply(id, "가상 미확보 이메일", randomUUID()),
                (e) => e.status === 409,
            );
            const a = await acquire(id),
                clientId = randomUUID();
            const sent = await clients.dh.reply(
                id,
                "가상 확보한 이메일",
                clientId,
                "reply",
                [],
                undefined,
                undefined,
                a.context,
            );
            const retry = await clients.dh.reply(
                id,
                "가상 확보한 이메일",
                clientId,
                "reply",
                [],
                undefined,
                undefined,
                a.context,
            );
            assert.equal(retry.id, sent.id);
            const deliveries = await db
                .select()
                .from(s.inboxEmailDeliveries)
                .where(eq(s.inboxEmailDeliveries.messageId, sent.id));
            assert.equal(deliveries.length, 1);
            assert.equal(deliveries[0].state, "queued");
        },
    );
    await check(
        "회원 이력 병합은 낮은 메시지 ID 추가도 작성 기준 무효화",
        async () => {
            const source = await visitor(),
                identity = (
                    await clients.dh.customerIdentity(
                        channels.dh.id,
                        contacts.dh.id,
                    )
                ).identityToken;
            await repo.sendVisitorMessage(
                channels.dh.publicKey,
                identity,
                { clientId: randomUUID(), body: "가상 병합 전 최신 회원 문의" },
                db,
            );
            const target = (
                    await clients.dh.conversations(channels.dh.id)
                ).find((c) => c.contactId === contacts.dh.id),
                a = await acquire(target.id);
            const max = async () =>
                Math.max(
                    ...(await messages(target.id))
                        .filter((m) => m.kind !== "note")
                        .map((m) => m.id),
                );
            const before = await max();
            await require("../src/lib/inbox/link-identity.ts").linkVisitorIdentity(
                channels.dh.publicKey,
                identity,
                { action: "identify", anonymousToken: source.token },
                db,
            );
            assert.equal(await max(), before);
            assert.notEqual(
                (await chat(target.id)).replyRevision,
                a.context.revision,
            );
            await assert.rejects(
                () => send(target.id, a.context),
                (e) => e.status === 409,
            );
        },
    );
    await check(
        "실제 AI 워커는 상담원 작성 중 결과를 초안으로 보존하고 자동 재전송하지 않음",
        async () => {
            const { aiTest } = ctx;
            aiTest.configured = true;
            const fact =
                "디자인 구독은 월 150,000원이며 작업 요청은 3개까지 가능합니다.";
            const knowledge = await clients.dh.createSupportKnowledge(
                8,
                "가상 답변 잠금 AI 근거",
                {
                    businessName: "가상 디하",
                    claims: [
                        {
                            text: fact,
                            sourceUrl: "https://example.test/guard-faq",
                            checkedAt: new Date(
                                Date.now() - 1000,
                            ).toISOString(),
                            purposes: ["customer_chat"],
                        },
                    ],
                },
            );
            await clients.dh.reviewSupportKnowledge(8, knowledge.id, "approve");
            const settings = await clients.dh.supportAiSettings(8);
            await clients.dh.updateSupportAiSettings(8, {
                ...settings.settings,
                knowledgeVersionId: knowledge.id,
                mode: "reply",
            });
            const v = await repo.startVisitorSession(
                channels.dh.publicKey,
                { name: "가상 잠금 AI 문의" },
                db,
            );
            await repo.sendVisitorMessage(
                channels.dh.publicKey,
                v.token,
                {
                    clientId: randomUUID(),
                    body: "디자인 구독 요금과 작업 요청 수가 궁금합니다.",
                },
                db,
            );
            const [job] = await db
                .select()
                .from(s.customerAiJobs)
                .where(eq(s.customerAiJobs.conversationId, v.id));
            assert.ok(job);
            const a = await acquire(v.id);
            const deps = {
                now: () => new Date(Date.now() + 20000),
                quota: async () => true,
                timeoutMs: 1000,
                call: async (_config, prompt) => {
                    const data = JSON.parse(prompt.user);
                    return {
                        content: JSON.stringify(
                            data.answer
                                ? {
                                      supported: true,
                                      confidence: 0.98,
                                      unsupportedClaims: [],
                                  }
                                : {
                                      decision: "answer",
                                      answer: fact,
                                      confidence: 0.98,
                                      reason: "승인 근거",
                                      citations: [
                                          {
                                              sourceId: data.sources[0].id,
                                              quote: data.sources[0].text,
                                          },
                                      ],
                                  },
                        ),
                        promptTokens: 100,
                        completionTokens: 30,
                        truncated: false,
                    };
                },
            };
            const {
                processSupportJob,
            } = require("../src/lib/customer-ai/worker.ts");
            const result = await processSupportJob(job.id, { exec: db, deps });
            assert.equal(result.state, "ready");
            assert.equal(result.answer, fact);
            assert.match(result.reason, /상담원이 답변을 작성 중/);
            assert.equal(
                (await messages(v.id)).filter((m) => m.kind === "reply").length,
                0,
            );
            assert.equal((await chat(v.id)).replyRevision, a.context.revision);
            await release(v.id, a.context);
            await processSupportJob(job.id, { exec: db, deps });
            assert.equal(
                (await messages(v.id)).filter((m) => m.kind === "reply").length,
                0,
            );
            const manual = await acquire(v.id);
            await clients.dh.reply(
                v.id,
                fact,
                randomUUID(),
                "reply",
                [],
                job.id,
                undefined,
                manual.context,
            );
            assert.equal(
                (await messages(v.id)).filter((m) => m.kind === "reply").length,
                1,
            );
            const next = await clients.dh.supportAiSettings(8);
            await clients.dh.updateSupportAiSettings(8, {
                ...next.settings,
                mode: "manual",
            });
        },
    );
    if (real)
        await check(
            "독립 PostgreSQL 연결의 동시 작성 시작은 한 창만 성공",
            async () => {
                const v = await visitor(),
                    revision = (await chat(v.id)).replyRevision,
                    pids = [];
                let go;
                const gate = new Promise((r) => (go = r));
                const jobs = [actor, b].map((who) =>
                    db.transaction(async (tx) => {
                        const [p] = await tx
                            .select({ pid: sql`pg_backend_pid()` })
                            .from(s.users)
                            .where(eq(s.users.id, who.userId));
                        pids.push(p.pid);
                        if (pids.length === 2) go();
                        await gate;
                        return guard.updateReplyLease(
                            who,
                            {
                                action: "acquire",
                                conversationId: v.id,
                                sessionId: randomUUID(),
                                revision,
                            },
                            tx,
                        );
                    }),
                );
                const results = await Promise.allSettled(jobs);
                assert.equal(new Set(pids).size, 2);
                assert.equal(
                    results.filter((r) => r.status === "fulfilled").length,
                    1,
                );
                assert.equal(
                    results.filter(
                        (r) =>
                            r.status === "rejected" && r.reason.status === 409,
                    ).length,
                    1,
                );
            },
        );
    if (real)
        await check(
            "독립 PostgreSQL 연결의 같은 작성 권한 동시 전송은 한 답변만 저장",
            async () => {
                const v = await visitor(),
                    a = await acquire(v.id),
                    pids = [];
                let go;
                const gate = new Promise((r) => (go = r));
                const jobs = ["가상 동시 답변 A", "가상 동시 답변 B"].map(
                    (body) =>
                        db.transaction(async (tx) => {
                            const [p] = await tx
                                .select({ pid: sql`pg_backend_pid()` })
                                .from(s.users)
                                .where(eq(s.users.id, actor.userId));
                            pids.push(p.pid);
                            if (pids.length === 2) go();
                            await gate;
                            return repo.sendAgentMessage(
                                actor,
                                v.id,
                                {
                                    clientId: randomUUID(),
                                    kind: "reply",
                                    body,
                                    replyGuard: a.context,
                                },
                                tx,
                            );
                        }),
                );
                const results = await Promise.allSettled(jobs);
                assert.equal(new Set(pids).size, 2);
                assert.equal(
                    results.filter((r) => r.status === "fulfilled").length,
                    1,
                );
                assert.equal(
                    results.filter(
                        (r) =>
                            r.status === "rejected" && r.reason.status === 409,
                    ).length,
                    1,
                );
                assert.equal(
                    (await messages(v.id)).filter((m) => m.kind === "reply")
                        .length,
                    1,
                );
            },
        );
    console.log(
        `답변 잠금 ${real ? "독립 PostgreSQL" : "PGlite"} QA ${count}개 통과 · 가상 데이터 전용 · 외부 발송/운영 DB 접근 없음`,
    );
    await pg.close();
}
(process.argv.includes("--postgres")
    ? require("./customer-platform-test-postgres.cjs").runPostgresPlatformCheck(
          (ctx) => scenario(ctx, true),
      )
    : runPlatformCheck(scenario)
).catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
