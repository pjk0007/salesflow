/* eslint-disable @typescript-eslint/no-require-imports -- 가상 파일·격리 PostgreSQL 검증 */
const assert = require("node:assert/strict"),
    { randomUUID, createHash } = require("node:crypto");
async function runFilesCheck(extra) {
    await require("./check-customer-activities.cjs").runActivityCheck(
        async (ctx) => {
            const {
                db,
                pg,
                actor,
                otherActor,
                clients,
                channels,
                contacts,
                dispatch,
                modules,
                repo,
                keys,
            } = ctx;
            const schema = require("../src/lib/db/schema.ts"),
                { eq, sql } = require("drizzle-orm"),
                files = require("../src/lib/inbox/files.ts"),
                audit = require("../src/lib/inbox/audit.ts"),
                { NextRequest } = require("next/server"),
                { generateToken } = require("../src/lib/auth.ts");
            let checks = 0;
            const check = async (name, fn) => {
                await fn();
                console.log(`PASS FILES ${++checks} ${name}`);
            };
            const boIdentity = await clients.bo.customerIdentity(
                channels.bo.id,
                contacts.bo.id,
            );
            await repo.startVisitorSession(
                channels.bo.publicKey,
                { identityToken: boIdentity.identityToken },
                db,
            );
            const chat = (await clients.dh.conversations(channels.dh.id)).find(
                    (c) => c.contactId === contacts.dh.id,
                ),
                boChat = (await clients.bo.conversations(channels.bo.id)).find(
                    (c) => c.contactId === contacts.bo.id,
                );
            const identity = await clients.dh.customerIdentity(
                channels.dh.id,
                contacts.dh.id,
            );
            const scope = await repo.staffFileScope(actor, chat.id, db),
                customerScope = await repo.visitorFileScope(
                    channels.dh.publicKey,
                    identity.identityToken,
                    db,
                );
            const bytes = Buffer.from(
                "상담 제안서 · 가상 파일입니다.\n",
                "utf8",
            );
            const upload = (data = {}, owner = scope) =>
                files.uploadAttachment(
                    owner,
                    {
                        clientId: randomUUID(),
                        kind: owner.publicOnly ? "customer" : "reply",
                        fileName: "가상 제안서.txt",
                        bytes,
                        ...data,
                    },
                    db,
                );
            const messenger = (
                path,
                method = "GET",
                body,
                token = identity.identityToken,
            ) =>
                dispatch(
                    `http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}${path}`,
                    {
                        method,
                        headers: {
                            Authorization: `Bearer ${token}`,
                            Origin: "http://127.0.0.1:3122",
                            ...(body instanceof FormData
                                ? {}
                                : { "Content-Type": "application/json" }),
                        },
                        ...(body === undefined
                            ? {}
                            : {
                                  body:
                                      body instanceof FormData
                                          ? body
                                          : JSON.stringify(body),
                              }),
                    },
                );
            let customerFile, replyFile, noteFile;
            await check(
                "스키마·실제 bytea 저장 및 SHA256 원본 일치",
                async () => {
                    customerFile = await upload({}, customerScope);
                    const [row] = await db
                        .select()
                        .from(schema.inboxAttachments)
                        .where(eq(schema.inboxAttachments.id, customerFile.id));
                    assert.equal(
                        row.sha256,
                        createHash("sha256").update(bytes).digest("hex"),
                    );
                    assert.deepEqual(
                        (
                            await files.downloadAttachment(
                                customerScope,
                                customerFile.id,
                                db,
                            )
                        ).bytes,
                        bytes,
                    );
                    assert.deepEqual(Object.keys(customerFile).sort(), [
                        "contentType",
                        "fileName",
                        "id",
                        "importMetadata",
                        "size",
                    ]);
                    assert.equal(customerFile.importMetadata, null);
                },
            );
            await check(
                "파일만 전송·CRM 공통 활동·재시도 중복 없음",
                async () => {
                    const payload = {
                        clientId: randomUUID(),
                        body: "",
                        attachmentIds: [customerFile.id],
                    };
                    const a = await repo.sendVisitorMessage(
                            channels.dh.publicKey,
                            identity.identityToken,
                            payload,
                            db,
                        ),
                        b = await repo.sendVisitorMessage(
                            channels.dh.publicKey,
                            identity.identityToken,
                            payload,
                            db,
                        );
                    assert.equal(a.id, b.id);
                    await assert.rejects(
                        repo.sendVisitorMessage(
                            channels.dh.publicKey,
                            identity.identityToken,
                            { ...payload, attachmentIds: [] },
                            db,
                        ),
                    );
                    await assert.rejects(
                        repo.sendVisitorMessage(
                            channels.dh.publicKey,
                            identity.identityToken,
                            { ...payload, body: "변경" },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    const detail = await repo.visitorDetail(
                        channels.dh.publicKey,
                        identity.identityToken,
                        db,
                    );
                    assert.equal(
                        detail.messages.find((m) => m.id === a.id)
                            .attachments[0].id,
                        customerFile.id,
                    );
                    const activity = await clients.dh.customerActivities(
                        8,
                        contacts.dh.id,
                    );
                    assert.ok(
                        activity.some((a) =>
                            a.summary.includes("가상 제안서.txt"),
                        ),
                    );
                    const journey =
                        await require("../src/lib/inbox/journey.ts").loadInboxJourney(
                            actor.orgId,
                            [1],
                            db,
                        );
                    assert.ok(
                        journey.some((e) =>
                            e.label.includes("가상 제안서.txt"),
                        ),
                    );
                },
            );
            await check(
                "이미 보낸 파일의 다른 메시지 재사용은 롤백",
                async () => {
                    const count = await db
                        .select({ n: sql`count(*)` })
                        .from(schema.inboxMessages);
                    await assert.rejects(
                        repo.sendVisitorMessage(
                            channels.dh.publicKey,
                            identity.identityToken,
                            {
                                clientId: randomUUID(),
                                body: "재사용",
                                attachmentIds: [customerFile.id],
                            },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    assert.deepEqual(
                        await db
                            .select({ n: sql`count(*)` })
                            .from(schema.inboxMessages),
                        count,
                    );
                    const staged = await upload({}, customerScope);
                    await assert.rejects(
                        db.transaction(async (tx) => {
                            await repo.sendVisitorMessage(
                                channels.dh.publicKey,
                                identity.identityToken,
                                {
                                    clientId: randomUUID(),
                                    body: "원자성 QA",
                                    attachmentIds: [staged.id],
                                },
                                tx,
                            );
                            throw new Error("첨부 전체 롤백");
                        }),
                        /첨부 전체 롤백/,
                    );
                    const [unbound] = await db
                        .select()
                        .from(schema.inboxAttachments)
                        .where(eq(schema.inboxAttachments.id, staged.id));
                    assert.equal(unbound.messageId, null);
                    assert.deepEqual(
                        (
                            await files.downloadAttachment(
                                customerScope,
                                staged.id,
                                db,
                            )
                        ).bytes,
                        bytes,
                    );
                    await files.cancelAttachment(customerScope, staged.id, db);
                },
            );
            await check(
                "실제 SDK multipart 업로드·첨부 답변·바이너리 다운로드",
                async () => {
                    replyFile = await clients.dh.uploadAttachment(
                        chat.id,
                        new Blob([bytes]),
                        "SDK 제안서.txt",
                        randomUUID(),
                    );
                    await clients.dh.reply(chat.id, "", randomUUID(), "reply", [
                        replyFile.id,
                    ]);
                    assert.deepEqual(
                        Buffer.from(
                            (await clients.dh.downloadAttachment(replyFile.id))
                                .bytes,
                        ),
                        bytes,
                    );
                    const response = await messenger(
                        `/attachments/${replyFile.id}`,
                    );
                    assert.equal(response.status, 200);
                    assert.deepEqual(
                        Buffer.from(await response.arrayBuffer()),
                        bytes,
                    );
                    assert.match(
                        response.headers.get("content-disposition"),
                        /attachment/,
                    );
                    assert.equal(
                        response.headers.get("access-control-allow-origin"),
                        "http://127.0.0.1:3122",
                    );
                    assert.equal(
                        response.headers.get("cache-control"),
                        "no-store",
                    );
                },
            );
            await check(
                "내부 메모 첨부는 직원에게만 보이고 고객 다운로드 차단",
                async () => {
                    noteFile = await upload({
                        kind: "note",
                        fileName: "팀 내부.txt",
                    });
                    await repo.sendAgentMessage(
                        actor,
                        chat.id,
                        {
                            clientId: randomUUID(),
                            body: "",
                            kind: "note",
                            attachmentIds: [noteFile.id],
                        },
                        db,
                    );
                    assert.ok(
                        (
                            await repo.conversationDetail(actor, chat.id, db)
                        ).messages.some((m) =>
                            m.attachments.some((f) => f.id === noteFile.id),
                        ),
                    );
                    assert.ok(
                        !(
                            await repo.visitorDetail(
                                channels.dh.publicKey,
                                identity.identityToken,
                                db,
                            )
                        ).messages.some((m) =>
                            m.attachments.some((f) => f.id === noteFile.id),
                        ),
                    );
                    assert.equal(
                        (await messenger(`/attachments/${noteFile.id}`)).status,
                        404,
                    );
                    assert.deepEqual(
                        Buffer.from(
                            (await clients.dh.downloadAttachment(noteFile.id))
                                .bytes,
                        ),
                        bytes,
                    );
                },
            );
            await check(
                "다른 조직·사업·계정·상담의 파일은 다운로드/결합 차단",
                async () => {
                    await assert.rejects(
                        clients.bo.downloadAttachment(replyFile.id),
                        (e) => e.status === 403,
                    );
                    await assert.rejects(
                        repo.staffDownloadScope(otherActor, replyFile.id, db),
                        (e) => e.status === 404,
                    );
                    await assert.rejects(
                        files.downloadAttachment(
                            { ...customerScope, conversationId: boChat.id },
                            replyFile.id,
                            db,
                        ),
                        (e) => e.status === 404,
                    );
                    const staged = await upload();
                    await assert.rejects(
                        files.downloadAttachment(
                            { ...scope, ownerKey: "wrong" },
                            staged.id,
                            db,
                        ),
                        (e) => e.status === 404,
                    );
                    await assert.rejects(
                        repo.sendAgentMessage(
                            actor,
                            boChat.id,
                            {
                                clientId: randomUUID(),
                                body: "범위",
                                kind: "reply",
                                attachmentIds: [staged.id],
                            },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    await files.cancelAttachment(scope, staged.id, db);
                },
            );
            await check(
                "읽기전용 API는 파일 업로드 불가·원본 조회 가능",
                async () => {
                    await assert.rejects(
                        clients.read.uploadAttachment(
                            chat.id,
                            new Blob([bytes]),
                            "x.txt",
                            randomUUID(),
                        ),
                        (e) => e.status === 403,
                    );
                    assert.deepEqual(
                        Buffer.from(
                            (
                                await clients.read.downloadAttachment(
                                    replyFile.id,
                                )
                            ).bytes,
                        ),
                        bytes,
                    );
                },
            );
            await check(
                "공개 multipart API·회원 JWT 갱신 후 같은 소유자 유지",
                async () => {
                    const form = new FormData();
                    form.set("file", new Blob([bytes]), "회원 파일.txt");
                    form.set("clientId", randomUUID());
                    form.set("kind", "customer");
                    const response = await messenger(
                        "/attachments",
                        "POST",
                        form,
                    );
                    assert.equal(response.status, 200);
                    const file = (await response.json()).data;
                    const refreshed = await clients.dh.customerIdentity(
                        channels.dh.id,
                        contacts.dh.id,
                    );
                    assert.equal(
                        (
                            await messenger(
                                "",
                                "POST",
                                {
                                    clientId: randomUUID(),
                                    body: "회원 파일",
                                    attachmentIds: [file.id],
                                },
                                refreshed.identityToken,
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (await messenger("/attachments", "POST", form)).status,
                        200,
                    );
                },
            );
            await check("익명 첨부·재시도·다른 익명 고객 격리", async () => {
                const a = await repo.startVisitorSession(
                        channels.dh.publicKey,
                        { name: "익명 파일 QA" },
                        db,
                    ),
                    b = await repo.startVisitorSession(
                        channels.dh.publicKey,
                        { name: "다른 익명" },
                        db,
                    );
                const owner = await repo.visitorFileScope(
                        channels.dh.publicKey,
                        a.token,
                        db,
                    ),
                    file = await upload({}, owner);
                const other = await repo.visitorFileScope(
                    channels.dh.publicKey,
                    b.token,
                    db,
                );
                await assert.rejects(
                    files.downloadAttachment(other, file.id, db),
                    (e) => e.status === 404,
                );
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    a.token,
                    {
                        clientId: randomUUID(),
                        body: "",
                        attachmentIds: [file.id],
                    },
                    db,
                );
                assert.deepEqual(
                    (await files.downloadAttachment(owner, file.id, db)).bytes,
                    bytes,
                );
            });
            await check(
                "업로드 멱등·내용 불일치 충돌·취소 후 blob 회수",
                async () => {
                    const clientId = randomUUID(),
                        file = await upload({ clientId });
                    assert.equal((await upload({ clientId })).id, file.id);
                    await assert.rejects(
                        upload({ clientId, bytes: Buffer.from("changed") }),
                        (e) => e.status === 409,
                    );
                    await files.cancelAttachment(scope, file.id, db);
                    await files.cancelAttachment(scope, file.id, db);
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(schema.inboxAttachmentBlobs)
                                .where(
                                    eq(
                                        schema.inboxAttachmentBlobs
                                            .attachmentId,
                                        file.id,
                                    ),
                                )
                        ).length,
                        0,
                    );
                    await assert.rejects(
                        upload({ clientId }),
                        (e) => e.status === 410,
                    );
                },
            );
            await check(
                "만료 첨부는 전송 차단·다음 업로드에서 bytea 회수",
                async () => {
                    const file = await upload();
                    await db
                        .update(schema.inboxAttachments)
                        .set({ expiresAt: new Date("2020-01-01") })
                        .where(eq(schema.inboxAttachments.id, file.id));
                    await assert.rejects(
                        repo.sendAgentMessage(
                            actor,
                            chat.id,
                            {
                                clientId: randomUUID(),
                                body: "만료",
                                kind: "reply",
                                attachmentIds: [file.id],
                            },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    const next = await upload();
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(schema.inboxAttachmentBlobs)
                                .where(
                                    eq(
                                        schema.inboxAttachmentBlobs
                                            .attachmentId,
                                        file.id,
                                    ),
                                )
                        ).length,
                        0,
                    );
                    await files.cancelAttachment(scope, next.id, db);
                },
            );
            await check(
                "파일 크기·5개·중복 ID·종류·파일명·MIME 계약",
                async () => {
                    await assert.rejects(
                        upload({ bytes: Buffer.alloc(0) }),
                        (e) => e.status === 413,
                    );
                    await assert.rejects(
                        upload({ bytes: Buffer.alloc(20 * 1024 * 1024 + 1) }),
                        (e) => e.status === 413,
                    );
                    await assert.rejects(
                        upload({ kind: "note" }, customerScope),
                        (e) => e.status === 403,
                    );
                    for (const ids of [
                        [replyFile.id, replyFile.id],
                        Array.from({ length: 6 }, () => randomUUID()),
                    ])
                        await assert.rejects(
                            repo.sendAgentMessage(
                                actor,
                                chat.id,
                                {
                                    clientId: randomUUID(),
                                    body: "x",
                                    kind: "reply",
                                    attachmentIds: ids,
                                },
                                db,
                            ),
                        );
                    const html = await upload({
                        bytes: Buffer.from("<svg onload='alert(1)'>"),
                        fileName: "../unsafe\n.svg",
                    });
                    assert.equal(html.contentType, "application/octet-stream");
                    assert.equal(html.fileName, ".._unsafe_.svg");
                    await files.cancelAttachment(scope, html.id, db);
                },
            );
            await check(
                "bounded multipart body와 잘못된 UUID는 JSON 오류",
                async () => {
                    const response = await dispatch(
                        `http://127.0.0.1:3120/api/v1/inbox/conversations/${chat.id}/attachments`,
                        {
                            method: "POST",
                            headers: {
                                Authorization: `Bearer ${keys.dh}`,
                                "Content-Type":
                                    "multipart/form-data; boundary=x",
                                "Content-Length": String(21 * 1024 * 1024),
                            },
                            body: "x",
                        },
                    );
                    assert.equal(response.status, 413);
                    assert.equal((await response.json()).success, false);
                    const streamed = await dispatch(
                        `http://127.0.0.1:3120/api/v1/inbox/conversations/${chat.id}/attachments`,
                        {
                            method: "POST",
                            headers: {
                                Authorization: `Bearer ${keys.dh}`,
                                "Content-Type":
                                    "multipart/form-data; boundary=x",
                            },
                            body: "x".repeat(21 * 1024 * 1024),
                        },
                    );
                    assert.equal(streamed.status, 413);
                    assert.equal(
                        (await messenger("/attachments/abc")).status,
                        400,
                    );
                    assert.equal(
                        (
                            await dispatch(
                                `http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}/attachments`,
                                {
                                    method: "POST",
                                    headers: { Origin: "https://other.test" },
                                    body: "{}",
                                },
                            )
                        ).status,
                        403,
                    );
                },
            );
            await check(
                "미전송 20개·사업 quota는 직렬화된 업로드에서 제한",
                async () => {
                    const staged = [];
                    for (let i = 0; i < 20; i++) staged.push(await upload());
                    await assert.rejects(upload(), (e) => e.status === 429);
                    for (const f of staged)
                        await files.cancelAttachment(scope, f.id, db);
                    const saved = process.env.INBOX_ATTACHMENT_QUOTA_MB;
                    process.env.INBOX_ATTACHMENT_QUOTA_MB = "20";
                    try {
                        await db.transaction(async (tx) => {
                            await tx
                                .update(schema.inboxAttachments)
                                .set({ size: 20 * 1024 * 1024 })
                                .where(
                                    eq(
                                        schema.inboxAttachments.id,
                                        replyFile.id,
                                    ),
                                );
                            await assert.rejects(
                                files.uploadAttachment(
                                    scope,
                                    {
                                        clientId: randomUUID(),
                                        kind: "reply",
                                        fileName: "quota.txt",
                                        bytes,
                                    },
                                    tx,
                                ),
                                (e) => e.status === 413,
                            );
                            throw new Error("rollback quota QA");
                        });
                    } catch (e) {
                        if (e.message !== "rollback quota QA") throw e;
                    } finally {
                        if (saved === undefined)
                            delete process.env.INBOX_ATTACHMENT_QUOTA_MB;
                        else process.env.INBOX_ATTACHMENT_QUOTA_MB = saved;
                    }
                },
            );
            await check(
                "동시 편집 version 충돌과 실제 변경만 감사 기록",
                async () => {
                    const before = (
                        await repo.conversationDetail(actor, chat.id, db)
                    ).conversation;
                    const first = await repo.patchConversation(
                        actor,
                        chat.id,
                        {
                            version: before.version,
                            tags: ["파일 검토", "파일 검토"],
                            assigneeId: actor.userId,
                        },
                        db,
                    );
                    assert.equal(first.version, before.version + 1);
                    await assert.rejects(
                        repo.patchConversation(
                            actor,
                            chat.id,
                            { version: before.version, priority: true },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    const events = await clients.dh.conversationAudit(chat.id);
                    const n = events.rows.length;
                    assert.equal(
                        events.rows[0].changes.assigneeId.afterLabel,
                        actor.name,
                    );
                    const same = await repo.patchConversation(
                        actor,
                        chat.id,
                        { version: first.version, tags: ["파일 검토"] },
                        db,
                    );
                    assert.equal(same.version, first.version);
                    assert.equal(
                        (await clients.dh.conversationAudit(chat.id)).rows
                            .length,
                        n,
                    );
                },
            );
            await check(
                "종료 후 고객 파일 재문의는 재개·버전·이력 원자 반영",
                async () => {
                    const closed = await repo.patchConversation(
                            actor,
                            chat.id,
                            { status: "closed" },
                            db,
                        ),
                        file = await upload({}, customerScope);
                    await repo.sendVisitorMessage(
                        channels.dh.publicKey,
                        identity.identityToken,
                        {
                            clientId: randomUUID(),
                            body: "",
                            attachmentIds: [file.id],
                        },
                        db,
                    );
                    const current = (
                        await repo.conversationDetail(actor, chat.id, db)
                    ).conversation;
                    assert.equal(current.status, "open");
                    assert.equal(current.version, closed.version + 1);
                    assert.ok(
                        (await clients.dh.conversationAudit(chat.id)).rows.some(
                            (e) => e.action === "customer.reopened",
                        ),
                    );
                },
            );
            await check(
                "감사 이력 사업·조직 격리와 100건 커서 누락 없음",
                async () => {
                    await assert.rejects(
                        clients.bo.conversationAudit(chat.id),
                        (e) => e.status === 403,
                    );
                    await db.insert(schema.inboxAuditEvents).values(
                        Array.from({ length: 105 }, () => ({
                            orgId: actor.orgId,
                            channelId: channels.dh.id,
                            conversationId: chat.id,
                            actorName: "가상 동시 QA",
                            action: "conversation.updated",
                            changes: {
                                priority: { before: false, after: true },
                            },
                            createdAt: new Date("2030-01-01"),
                        })),
                    );
                    const first = await clients.dh.conversationAudit(chat.id),
                        second = await clients.dh.conversationAudit(
                            chat.id,
                            first.rows.at(-1).id,
                        );
                    assert.equal(first.rows.length, 100);
                    assert.ok(second.rows.length >= 5);
                    assert.equal(
                        new Set(
                            [...first.rows, ...second.rows].map((r) => r.id),
                        ).size,
                        first.rows.length + second.rows.length,
                    );
                    await assert.rejects(
                        audit.inboxAuditPage(
                            actor.orgId,
                            channels.bo.id,
                            boChat.id,
                            first.rows[0].id,
                            db,
                        ),
                        (e) => e.status === 404,
                    );
                },
            );
            await check(
                "상담창 실제 변경만 설정 감사·직원 세션 없는 native API 차단",
                async () => {
                    const initial = await audit.inboxAuditPage(
                        actor.orgId,
                        channels.dh.id,
                        null,
                        undefined,
                        db,
                    );
                    assert.ok(
                        initial.rows.some(
                            (r) => r.action === "channel.created",
                        ),
                    );
                    await repo.saveChannel(
                        actor,
                        { ...channels.dh, greeting: "파일 상담 안내" },
                        db,
                    );
                    const changed = await audit.inboxAuditPage(
                        actor.orgId,
                        channels.dh.id,
                        null,
                        undefined,
                        db,
                    );
                    assert.equal(changed.rows.length, initial.rows.length + 1);
                    const unauth = await modules[
                        "inbox/conversations/[id]/audit"
                    ].GET(
                        new NextRequest(
                            `http://127.0.0.1:3120/api/inbox/conversations/${chat.id}/audit`,
                        ),
                        { params: Promise.resolve({ id: chat.id }) },
                    );
                    assert.equal(unauth.status, 401);
                    const signed = new NextRequest(
                        `http://127.0.0.1:3120/api/inbox/conversations/${chat.id}/audit`,
                        {
                            headers: {
                                Authorization: `Bearer ${generateToken({ ...actor, email: "qa@example.test" })}`,
                            },
                        },
                    );
                    assert.equal(
                        (
                            await modules["inbox/conversations/[id]/audit"].GET(
                                signed,
                                { params: Promise.resolve({ id: chat.id }) },
                            )
                        ).status,
                        200,
                    );
                },
            );
            console.log(
                `상담 파일·감사 QA: ${checks}개 통과. 가상 파일·격리 DB만 사용, 외부 저장/발송 0건.`,
            );
            if (extra) await extra(ctx);
            else await pg.close();
        },
    );
}
if (require.main === module)
    runFilesCheck().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
module.exports = { runFilesCheck };
