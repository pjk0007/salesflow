/* eslint-disable @typescript-eslint/no-require-imports -- 격리 DB·가상 로그인 이력 연결 QA */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");

async function runIdentityCheck() {
    await runPlatformCheck(async (ctx) => {
        const { db, pg, actor, clients, channels, contacts, repo, dispatch } =
            ctx;
        const s = require("../src/lib/db/schema.ts");
        const { eq, and } = require("drizzle-orm");
        const files = require("../src/lib/inbox/files.ts");
        const { inboxAuditPage } = require("../src/lib/inbox/audit.ts");
        let checks = 0;
        async function check(name, fn) {
            await fn();
            console.log(`PASS IDENTITY ${++checks} ${name}`);
        }
        async function api(key, token, body, expected = 200) {
            const response = await dispatch(
                `http://127.0.0.1:3120/api/messenger/${key}`,
                {
                    method: body ? "POST" : "GET",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    ...(body ? { body: JSON.stringify(body) } : {}),
                },
            );
            const result = await response.json();
            assert.equal(response.status, expected, JSON.stringify(result));
            return result.data;
        }
        const key = channels.dh.publicKey;
        const identity = (
            await clients.dh.customerIdentity(channels.dh.id, contacts.dh.id)
        ).identityToken;
        const anon = (name = "가상 비회원") =>
            api(key, null, {
                action: "session",
                name,
                email: contacts.dh.email || "member@example.test",
            });
        const send = (token, body, extra = {}) =>
            api(key, token, { clientId: randomUUID(), body, ...extra });
        const link = (source, token = identity, expected = 200) =>
            api(
                key,
                token,
                { action: "identify", anonymousToken: source.token },
                expected,
            );
        const memberChat = (
            await clients.dh.conversations(channels.dh.id)
        ).find((c) => c.contactId === contacts.dh.id);
        const source = await anon();
        const question = await send(
            source.token,
            "로그인 전에 문의한 가상 요금제 질문",
        );
        let sentFile, noteFile, pendingFile, oldScope;
        await check(
            "입력 이메일이 같아도 기존 회원 상담과 자동 연결하지 않음",
            async () => {
                const result = await api(key, source.token);
                assert.equal(result.profile.identified, false);
                assert.equal(result.messages.length, 1);
                assert.notEqual(source.id, memberChat.id);
            },
        );
        await check(
            "서명 없는 인증·다른 사업·없는 익명 증명으로 연결할 수 없음",
            async () => {
                await link(source, "", 401);
                await link(source, source.token, 401);
                const boIdentity = (
                    await clients.bo.customerIdentity(
                        channels.bo.id,
                        contacts.bo.id,
                    )
                ).identityToken;
                await link(source, boIdentity, 401);
                await link({ token: "a".repeat(64) }, identity, 401);
            },
        );
        await check(
            "연결 전 파일·메모·감사와 미전송 파일을 실제 SQL에 준비",
            async () => {
                oldScope = await repo.visitorFileScope(key, source.token, db);
                const upload = (scope, kind, name) =>
                    files.uploadAttachment(
                        scope,
                        {
                            kind,
                            clientId: randomUUID(),
                            fileName: name,
                            bytes: Buffer.from(name),
                        },
                        db,
                    );
                sentFile = await upload(oldScope, "customer", "고객자료.txt");
                pendingFile = await upload(
                    oldScope,
                    "customer",
                    "미전송자료.txt",
                );
                await send(source.token, "로그인 전 첨부", {
                    attachmentIds: [sentFile.id],
                });
                const staff = await repo.staffFileScope(actor, source.id, db);
                noteFile = await upload(staff, "note", "직원메모.txt");
                await repo.sendAgentMessage(
                    actor,
                    source.id,
                    {
                        clientId: randomUUID(),
                        body: "공개하지 않는 직원 메모",
                        kind: "note",
                        attachmentIds: [noteFile.id],
                    },
                    db,
                );
                await repo.patchConversation(
                    actor,
                    source.id,
                    {
                        priority: true,
                        tags: ["도입 관심"],
                        assigneeId: actor.userId,
                    },
                    db,
                );
                await db.insert(s.customerAiJobs).values({
                    orgId: actor.orgId,
                    workspaceId: 8,
                    conversationId: source.id,
                    clientId: randomUUID(),
                    sourceMessageId: question.id,
                    lastPublicId: question.id,
                    mode: "reply",
                    settingsVersion: 1,
                    settingsSnapshot: {},
                    context: {},
                    state: "generating",
                    leaseId: randomUUID(),
                    leaseUntil: new Date(Date.now() + 60000),
                });
                const [workflow] = await db
                    .insert(s.customerWorkflows)
                    .values({
                        orgId: actor.orgId,
                        workspaceId: 8,
                        name: "격리 예약 QA",
                    })
                    .returning();
                const [revision] = await db
                    .insert(s.customerWorkflowRevisions)
                    .values({
                        workflowId: workflow.id,
                        version: 1,
                        name: "격리 예약 QA",
                        description: "",
                        definition: {},
                        fingerprint: "a".repeat(64),
                    })
                    .returning();
                const [event] = await db
                    .select()
                    .from(s.platformEvents)
                    .where(
                        and(
                            eq(s.platformEvents.workspaceId, 8),
                            eq(
                                s.platformEvents.eventKey,
                                `message:${question.id}`,
                            ),
                        ),
                    );
                await db.insert(s.customerWorkflowRuns).values({
                    orgId: actor.orgId,
                    workspaceId: 8,
                    workflowId: workflow.id,
                    revisionId: revision.id,
                    generation: 1,
                    eventId: event.id,
                    eventSnapshot: event.payload,
                    state: "waiting",
                    eligibleAt: new Date(Date.now() + 60000),
                });
            },
        );
        await check(
            "기존 회원 상담으로 메시지·원래 번호·첨부·메모를 손실 없이 연결",
            async () => {
                const result = await link(source);
                assert.equal(result.id, memberChat.id);
                assert.equal(result.merged, true);
                const staff = await repo.conversationDetail(
                    actor,
                    memberChat.id,
                    db,
                );
                assert.ok(
                    staff.messages.some(
                        (m) => m.body === "공개하지 않는 직원 메모",
                    ),
                );
                assert.equal(
                    staff.messages.find((m) => m.id === question.id)
                        .originConversationId,
                    source.id,
                );
                assert.ok(staff.conversation.tags.includes("도입 관심"));
                assert.equal(staff.conversation.priority, true);
                assert.equal(staff.conversation.assigneeId, actor.userId);
                assert.equal(staff.conversation.aiState, "human");
                const publicData = await api(key, identity);
                assert.ok(
                    publicData.messages.some((m) => m.id === question.id),
                );
                assert.ok(!JSON.stringify(publicData).includes("직원메모"));
                assert.ok(
                    !JSON.stringify(publicData).includes("공개하지 않는"),
                );
                assert.ok(
                    !JSON.stringify(publicData).includes(
                        "originConversationId",
                    ),
                );
            },
        );
        await check(
            "연결 후 공개 파일은 복구되고 내부 파일은 계속 비공개",
            async () => {
                const memberScope = await repo.visitorFileScope(
                    key,
                    identity,
                    db,
                );
                assert.equal(
                    (
                        await files.downloadAttachment(
                            memberScope,
                            sentFile.id,
                            db,
                        )
                    ).bytes.toString(),
                    "고객자료.txt",
                );
                await assert.rejects(
                    files.downloadAttachment(memberScope, noteFile.id, db),
                    (e) => e.status === 404,
                );
                await assert.rejects(
                    files.downloadAttachment(oldScope, sentFile.id, db),
                    (e) => e.status === 404,
                );
                await assert.rejects(
                    files.uploadAttachment(
                        oldScope,
                        {
                            clientId: randomUUID(),
                            kind: "customer",
                            fileName: "늦은첨부.txt",
                            bytes: Buffer.from("old"),
                        },
                        db,
                    ),
                    (e) => e.status === 409,
                );
                const [pending] = await db
                    .select()
                    .from(s.inboxAttachments)
                    .where(eq(s.inboxAttachments.id, pendingFile.id));
                assert.ok(pending.cancelledAt);
            },
        );
        await check(
            "옛 익명 토큰·직원 수정은 차단되고 수신함 집계에 중복 노출하지 않음",
            async () => {
                await api(key, source.token, undefined, 401);
                await api(
                    key,
                    source.token,
                    { body: "늦은 메시지", clientId: randomUUID() },
                    401,
                );
                await assert.rejects(
                    repo.patchConversation(
                        actor,
                        source.id,
                        { status: "open" },
                        db,
                    ),
                    (e) => e.status === 404,
                );
                const list = await repo.conversationListPage(
                    actor,
                    channels.dh.id,
                    {},
                    undefined,
                    undefined,
                    db,
                );
                assert.ok(!list.rows.some((c) => c.id === source.id));
                const oldLink = await repo.conversationDetail(
                    actor,
                    source.id,
                    db,
                );
                assert.equal(oldLink.conversation.id, memberChat.id);
                assert.ok(oldLink.messages.some((m) => m.id === question.id));
                assert.ok(
                    list.rows.some((c) => c.id === memberChat.id && c.unread),
                );
            },
        );
        await check(
            "진행 중 AI·예약 자동화는 취소되고 감사·CRM 공개 활동만 이어짐",
            async () => {
                const [job] = await db
                    .select()
                    .from(s.customerAiJobs)
                    .where(eq(s.customerAiJobs.conversationId, source.id));
                assert.equal(job.state, "stale");
                assert.equal(job.leaseId, null);
                const [run] = await db.select().from(s.customerWorkflowRuns);
                assert.equal(run.state, "cancelled");
                assert.equal(run.leaseId, null);
                const audit = await inboxAuditPage(
                    actor.orgId,
                    channels.dh.id,
                    memberChat.id,
                    undefined,
                    db,
                );
                assert.ok(
                    audit.rows.some((r) => r.action === "identity.linked"),
                );
                assert.ok(audit.rows.some((r) => r.changes.priority));
                const activity = await clients.dh.customerActivities(
                    8,
                    contacts.dh.id,
                );
                assert.equal(
                    activity.filter(
                        (a) => a.eventKey === `message:${question.id}`,
                    ).length,
                    1,
                );
                assert.ok(!activity.some((a) => a.action === "note"));
            },
        );
        await check(
            "동일 요청 재시도는 멱등이며 다른 회원에게 재연결할 수 없음",
            async () => {
                assert.equal((await link(source)).id, memberChat.id);
                const replay = await send(
                    identity,
                    "로그인 전에 문의한 가상 요금제 질문",
                    { clientId: question.clientId },
                );
                assert.equal(replay.id, question.id);
                const b = await clients.dh.upsertContact({
                    workspaceId: 8,
                    externalId: "identity-b",
                    name: "가상 B",
                });
                const bToken = (
                    await clients.dh.customerIdentity(channels.dh.id, b.id)
                ).identityToken;
                await link(source, bToken, 409);
                assert.equal((await api(key, bToken)).messages.length, 0);
                const events = await db
                    .select()
                    .from(s.platformEvents)
                    .where(
                        eq(s.platformEvents.eventKey, `identity:${source.id}`),
                    );
                assert.equal(events.length, 1);
                assert.equal(events[0].type, "conversation.identified");
            },
        );
        await check(
            "회원 상담이 없으면 비회원 대화 자체를 연결하고 삭제 후에도 옛 토큰을 부활시키지 않음",
            async () => {
                const c = await clients.dh.upsertContact({
                    workspaceId: 8,
                    externalId: "new-identity",
                    name: "가상 신규 회원",
                });
                const token = (
                    await clients.dh.customerIdentity(channels.dh.id, c.id)
                ).identityToken;
                const fresh = await anon("신규 비회원");
                await send(fresh.token, "회원가입 전 문의");
                const result = await link(fresh, token);
                assert.equal(result.id, fresh.id);
                assert.equal(result.merged, false);
                assert.equal((await link(fresh, token)).id, fresh.id);
                await api(key, fresh.token, undefined, 401);
                await db
                    .delete(s.crmContacts)
                    .where(eq(s.crmContacts.id, c.id));
                await api(key, fresh.token, undefined, 401);
                await link(fresh, identity, 409);
            },
        );
        await check(
            "메시지 번호 충돌 시 일부 이동 없이 전체 롤백",
            async () => {
                const collision = await anon("충돌 QA");
                const [old] = await db
                    .select()
                    .from(s.inboxMessages)
                    .where(eq(s.inboxMessages.conversationId, memberChat.id))
                    .limit(1);
                await send(collision.token, "충돌 시 보존", {
                    clientId: old.clientId,
                });
                await link(collision, identity, 409);
                assert.ok(
                    (await api(key, collision.token)).messages.some(
                        (m) => m.body === "충돌 시 보존",
                    ),
                );
                const [row] = await db
                    .select()
                    .from(s.inboxConversations)
                    .where(eq(s.inboxConversations.id, collision.id));
                assert.equal(row.mergedIntoId, null);
                assert.equal(row.contactId, null);
            },
        );
        await check(
            "최종 활동 저장 실패 시 메시지·토큰·첨부·이전 상담을 전체 복원",
            async () => {
                const failed = await anon("롤백 QA");
                await send(failed.token, "롤백 후에도 남을 문의");
                await pg.exec(
                    `CREATE FUNCTION qa_reject_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='identity.linked' THEN RAISE EXCEPTION 'isolated rollback QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_reject_identity BEFORE INSERT ON crm_activities FOR EACH ROW EXECUTE FUNCTION qa_reject_identity();`,
                );
                try {
                    await link(failed, identity, 500);
                    assert.ok(
                        (await api(key, failed.token)).messages.some(
                            (m) => m.body === "롤백 후에도 남을 문의",
                        ),
                    );
                    assert.ok(
                        !(await api(key, identity)).messages.some(
                            (m) => m.body === "롤백 후에도 남을 문의",
                        ),
                    );
                    const [row] = await db
                        .select()
                        .from(s.inboxConversations)
                        .where(eq(s.inboxConversations.id, failed.id));
                    assert.equal(row.mergedIntoId, null);
                } finally {
                    await pg.exec(
                        "DROP TRIGGER qa_reject_identity ON crm_activities; DROP FUNCTION qa_reject_identity();",
                    );
                }
                await link(failed);
                assert.ok(
                    (await api(key, identity)).messages.some(
                        (m) => m.body === "롤백 후에도 남을 문의",
                    ),
                );
            },
        );
        await check(
            "백오피스랩에서도 같은 공개 계약으로 회원 연결·기기 복원이 가능",
            async () => {
                const bo = await api(channels.bo.publicKey, null, {
                    action: "session",
                    name: "백오랩 비회원",
                });
                await api(channels.bo.publicKey, bo.token, {
                    clientId: randomUUID(),
                    body: "백오랩 연결 QA",
                });
                const boToken = (
                    await clients.bo.customerIdentity(
                        channels.bo.id,
                        contacts.bo.id,
                    )
                ).identityToken;
                await api(channels.bo.publicKey, boToken, {
                    action: "identify",
                    anonymousToken: bo.token,
                });
                const another = (
                    await clients.bo.customerIdentity(
                        channels.bo.id,
                        contacts.bo.id,
                    )
                ).identityToken;
                assert.ok(
                    (await api(channels.bo.publicKey, another)).messages.some(
                        (m) => m.body === "백오랩 연결 QA",
                    ),
                );
                assert.ok(
                    !(await api(key, identity)).messages.some(
                        (m) => m.body === "백오랩 연결 QA",
                    ),
                );
            },
        );
        console.log(`회원 이력 연결 QA: ${checks}개 통과. 실제 외부 전송 0건.`);
        await pg.close();
    });
}
runIdentityCheck().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
