/* eslint-disable @typescript-eslint/no-require-imports -- 격리 DB·가상 Gmail로 첨부 실제 바이트 검증 */
const assert = require("node:assert/strict"),
    { randomUUID, createHash } = require("node:crypto");
async function runEmailFilesCheck(extra) {
    await require("./check-inbox-email.cjs").runEmailCheck(async (ctx) => {
        const {
            db,
            pg,
            actor,
            otherActor,
            clients,
            emailMailboxes: boxes,
            repo,
            modules,
            channels,
        } = ctx;
        const s = require("../src/lib/db/schema.ts"),
            { eq } = require("drizzle-orm"),
            f = require("../src/lib/inbox-email/files.ts"),
            gmail = require("../src/lib/inbox-email/gmail.ts"),
            { clearGmailTokenCache } = require("../src/lib/gmail-client.ts");
        const png = Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yG5kAAAAASUVORK5CYII=",
                "base64",
            ),
            pdf = Buffer.from("%PDF-1.7\n가상 고객 문서\n%%EOF"),
            longId = "A".repeat(600);
        const digest = (b) => createHash("sha256").update(b).digest("hex"),
            count = async (table) => (await db.select().from(table)).length;
        const input = (n, files) => ({
            providerMessageId: `file-mail-${n}`,
            providerThreadId: `file-thread-${n}`,
            rfcMessageId: `<file-mail-${n}@example.test>`,
            from: "file-lead@example.test",
            fromName: "첨부 QA 고객",
            to: [boxes.dh.address],
            subject: "첨부 자료 문의",
            body: "가상 첨부 자료를 확인해주세요.",
            receivedAt: new Date().toISOString(),
            files,
        });
        const def = (name, bytes, providerId) => ({
            name,
            size: bytes.length,
            contentType: "application/octet-stream",
            providerId,
        });
        let checks = 0,
            receipt,
            files,
            receivedId;
        const check = async (name, fn) => {
            await fn();
            console.log(`PASS EMAIL FILE ${++checks} ${name}`);
        };
        const getItem = async (id) =>
            (
                await db
                    .select()
                    .from(s.inboxEmailFiles)
                    .where(eq(s.inboxEmailFiles.id, id))
            )[0];
        try {
            await check(
                "수신 파일별 대기 상태·긴 Gmail ID·중복 수신 번호",
                async () => {
                    const raw = input(1, [
                        def("고객 로고.png", png, longId),
                        def("문의 자료.pdf", pdf, "part-pdf"),
                    ]);
                    receipt = await clients.dh.receiveEmail(boxes.dh.id, raw);
                    receivedId = receipt.conversationId;
                    files = await clients.dh.emailReceiptFiles(
                        receipt.receiptId,
                    );
                    assert.equal(files.length, 2);
                    assert.equal(files[0].state, "pending");
                    assert.equal(files[0].providerId, longId);
                    const created = (
                        await db.select().from(s.platformEvents)
                    ).find(
                        (e) => e.eventKey === `message:${receipt.messageId}`,
                    );
                    assert.equal(
                        created.payload.data.message.sourceAttachmentCount,
                        2,
                    );
                    const activity = (
                        await db.select().from(s.crmActivities)
                    ).find(
                        (a) => a.eventKey === `message:${receipt.messageId}`,
                    );
                    assert.equal(activity.metadata.attachmentCount, 2);
                    const before = await count(s.inboxEmailFiles);
                    await clients.dh.receiveEmail(boxes.dh.id, raw);
                    assert.equal(await count(s.inboxEmailFiles), before);
                    await assert.rejects(
                        clients.bo.emailReceiptFiles(receipt.receiptId),
                        (e) => e.status === 403,
                    );
                    await assert.rejects(
                        f.ownedEmailFile(otherActor, files[0].id, db),
                        (e) => e.status === 404,
                    );
                },
            );
            await check(
                "파일 바이트 수신·보호 다운로드·동일 업로드 멱등",
                async () => {
                    await clients.dh.uploadEmailFile(
                        files[0].id,
                        new Blob([png]),
                        "임의 업로드 이름.bin",
                    );
                    const saved = await getItem(files[0].id);
                    assert.equal(saved.state, "available");
                    const bytes = await clients.dh.downloadAttachment(
                        saved.attachmentId,
                    );
                    assert.equal(digest(Buffer.from(bytes.bytes)), digest(png));
                    assert.equal(bytes.contentType, "image/png");
                    const before = await count(s.inboxAttachments);
                    await clients.dh.uploadEmailFile(
                        files[0].id,
                        new Blob([png]),
                        "재시도 이름.bin",
                    );
                    assert.equal(await count(s.inboxAttachments), before);
                    const altered = Buffer.from(png);
                    altered[altered.length - 1] ^= 1;
                    await assert.rejects(
                        clients.dh.uploadEmailFile(
                            files[0].id,
                            new Blob([altered]),
                            "changed.bin",
                        ),
                        (e) => e.status === 409,
                    );
                    assert.equal(
                        digest(
                            Buffer.from(
                                (
                                    await clients.dh.downloadAttachment(
                                        saved.attachmentId,
                                    )
                                ).bytes,
                            ),
                        ),
                        digest(png),
                    );
                    await assert.rejects(
                        clients.bo.downloadAttachment(saved.attachmentId),
                        (e) => e.status === 403,
                    );
                    await assert.rejects(
                        clients.read.uploadEmailFile(
                            files[1].id,
                            new Blob([pdf]),
                            "x.pdf",
                        ),
                        (e) => e.status === 403,
                    );
                    const identity = await clients.dh.customerIdentity(
                            channels.dh.id,
                            (
                                await repo.ownedConversation(
                                    actor,
                                    receivedId,
                                    db,
                                )
                            ).contactId,
                        ),
                        r = await ctx.dispatch(
                            `http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}/attachments/${saved.attachmentId}`,
                            {
                                headers: {
                                    authorization: `Bearer ${identity.identityToken}`,
                                },
                            },
                        );
                    assert.equal(r.status, 404);
                },
            );
            await check(
                "실패→사람 재요청→재수신 완료·늦은 실패가 완료 덮어쓰기 금지",
                async () => {
                    await clients.dh.failEmailFile(
                        files[1].id,
                        "download_failed",
                    );
                    assert.equal((await getItem(files[1].id)).state, "failed");
                    const { generateToken } = require("../src/lib/auth.ts"),
                        { NextRequest } = require("next/server"),
                        request = new NextRequest(
                            `http://127.0.0.1:3120/api/email-files/${files[1].id}`,
                            {
                                method: "POST",
                                headers: {
                                    authorization:
                                        "Bearer " +
                                        generateToken({
                                            ...actor,
                                            email: "staff@example.test",
                                        }),
                                    "content-type": "application/json",
                                },
                                body: JSON.stringify({ action: "retry" }),
                            },
                        );
                    assert.equal(
                        (
                            await modules["email-files/[id]"].POST(request, {
                                params: Promise.resolve({ id: files[1].id }),
                            })
                        ).status,
                        200,
                    );
                    assert.equal((await getItem(files[1].id)).state, "pending");
                    await clients.dh.uploadEmailFile(
                        files[1].id,
                        new Blob([pdf]),
                        "원본.pdf",
                    );
                    await clients.dh.failEmailFile(
                        files[1].id,
                        "source_missing",
                    );
                    assert.equal(
                        (await getItem(files[1].id)).state,
                        "available",
                    );
                    const detail = await repo.conversationDetail(
                        actor,
                        receivedId,
                        db,
                    );
                    assert.equal(detail.messages[0].attachments.length, 2);
                    assert.ok(
                        detail.messages[0].email.files.every(
                            (file) => file.state === "available",
                        ),
                    );
                    assert.equal(
                        (await db.select().from(s.crmActivities)).filter(
                            (row) => row.action === "email.attachment",
                        ).length,
                        2,
                    );
                },
            );
            await check(
                "파일 제한·크기 불일치·저장 실패의 바이트/활동 원자 롤백",
                async () => {
                    const r = await clients.dh.receiveEmail(
                            boxes.dh.id,
                            input(2, [
                                {
                                    name: "큰 파일.zip",
                                    size: 21 * 1024 * 1024,
                                    contentType: "application/zip",
                                    providerId: "large",
                                },
                                {
                                    name: "빈 파일.txt",
                                    size: 0,
                                    contentType: "text/plain",
                                    providerId: "empty",
                                },
                                def("복구 자료.png", png, "recover"),
                            ]),
                        ),
                        rows = await clients.dh.emailReceiptFiles(r.receiptId);
                    assert.deepEqual(
                        rows.map((row) => row.state),
                        ["blocked", "blocked", "pending"],
                    );
                    await assert.rejects(
                        clients.dh.uploadEmailFile(
                            rows[0].id,
                            new Blob([png]),
                            "large.zip",
                        ),
                        (e) => e.status === 413,
                    );
                    await assert.rejects(
                        clients.dh.uploadEmailFile(
                            rows[2].id,
                            new Blob([Buffer.from("wrong")]),
                            "wrong.png",
                        ),
                        (e) => e.status === 409,
                    );
                    const before = await count(s.inboxAttachments),
                        activities = await count(s.crmActivities);
                    await pg.exec(
                        "CREATE FUNCTION qa_fail_email_file() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa_file_write'; END $$; CREATE TRIGGER qa_fail_email_file BEFORE UPDATE ON inbox_email_files FOR EACH ROW EXECUTE FUNCTION qa_fail_email_file();",
                    );
                    await assert.rejects(
                        f.storeEmailFile(actor, rows[2].id, png, db),
                    );
                    assert.equal(await count(s.inboxAttachments), before);
                    assert.equal(await count(s.crmActivities), activities);
                    assert.equal((await getItem(rows[2].id)).state, "pending");
                    await pg.exec(
                        "DROP TRIGGER qa_fail_email_file ON inbox_email_files; DROP FUNCTION qa_fail_email_file();",
                    );
                    await clients.dh.uploadEmailFile(
                        rows[2].id,
                        new Blob([png]),
                        "recover.png",
                    );
                },
            );
            let sentRaw = "",
                sends = 0;
            const credentials = {
                clientId: "files-fake",
                clientSecret: "files-fake-secret",
                refreshToken: "files-fake-refresh",
            };
            const transport = async (url, init) => {
                if (String(url).includes("oauth2"))
                    return Response.json({
                        access_token: "files-fake-access",
                        expires_in: 3600,
                    });
                if (String(url).endsWith("profile"))
                    return Response.json({ emailAddress: boxes.dh.address });
                sends++;
                const payload = JSON.parse(init.body);
                sentRaw = Buffer.from(payload.raw, "base64url").toString();
                return Response.json({ id: "files-sent-" + sends });
            };
            await check(
                "답장 첨부 임대·원본 해시·권한/메모 격리·Gmail multipart 실제 바이트",
                async () => {
                    const noteBytes = Buffer.from(
                        "%PDF-1.7 private-note-unique-qa-only",
                    );
                    const note = await clients.dh.uploadAttachment(
                        receivedId,
                        new Blob([noteBytes]),
                        "팀 전용.pdf",
                        randomUUID(),
                        "note",
                    );
                    await clients.dh.reply(
                        receivedId,
                        "내부 비밀 문서",
                        randomUUID(),
                        "note",
                        [note.id],
                    );
                    const a = await clients.dh.uploadAttachment(
                            receivedId,
                            new Blob([png]),
                            "한글 로고.png",
                            randomUUID(),
                        ),
                        b = await clients.dh.uploadAttachment(
                            receivedId,
                            new Blob([pdf]),
                            "상담 안내.pdf",
                            randomUUID(),
                        );
                    await clients.dh.reply(
                        receivedId,
                        "",
                        randomUUID(),
                        "reply",
                        [a.id, b.id],
                    );
                    const lease = await clients.dh.claimEmail(boxes.dh.id);
                    assert.equal(lease.attachments.length, 2);
                    assert.equal(
                        lease.attachments.find((file) => file.id === a.id)
                            .sha256,
                        digest(png),
                    );
                    await assert.rejects(
                        clients.bo.downloadEmailDeliveryFile(
                            lease.id,
                            a.id,
                            lease.leaseToken,
                        ),
                        (e) => e.status === 403,
                    );
                    await assert.rejects(
                        clients.dh.downloadEmailDeliveryFile(
                            lease.id,
                            note.id,
                            lease.leaseToken,
                        ),
                        (e) => e.status === 404,
                    );
                    await assert.rejects(
                        clients.dh.downloadEmailDeliveryFile(
                            lease.id,
                            a.id,
                            randomUUID(),
                        ),
                        (e) => e.status === 409,
                    );
                    assert.equal(
                        digest(
                            Buffer.from(
                                (
                                    await clients.dh.downloadEmailDeliveryFile(
                                        lease.id,
                                        a.id,
                                        lease.leaseToken,
                                    )
                                ).bytes,
                            ),
                        ),
                        digest(png),
                    );
                    await db
                        .update(s.inboxEmailDeliveries)
                        .set({ leaseUntil: new Date(0) })
                        .where(eq(s.inboxEmailDeliveries.id, lease.id));
                    clearGmailTokenCache();
                    const result = await gmail.deliverGmailReply(
                        clients.dh,
                        boxes.dh.id,
                        credentials,
                        transport,
                    );
                    assert.equal(result.state, "sent");
                    assert.equal(sends, 1);
                    assert.ok(sentRaw.includes("multipart/mixed"));
                    assert.ok(sentRaw.includes("filename*0*=UTF-8''"));
                    assert.ok(
                        sentRaw
                            .replaceAll("\r\n", "")
                            .includes(png.toString("base64")),
                    );
                    assert.ok(
                        sentRaw
                            .replaceAll("\r\n", "")
                            .includes(pdf.toString("base64")),
                    );
                    assert.ok(
                        !sentRaw
                            .replaceAll("\r\n", "")
                            .includes(noteBytes.toString("base64")),
                    );
                    await assert.rejects(
                        clients.dh.downloadEmailDeliveryFile(
                            lease.id,
                            a.id,
                            lease.leaseToken,
                        ),
                        (e) => e.status === 409,
                    );
                },
            );
            await check(
                "첨부 준비 실패는 발송 시작 전 실패·사람 재시도",
                async () => {
                    const a = await clients.dh.uploadAttachment(
                        receivedId,
                        new Blob([png]),
                        "준비 검증.png",
                        randomUUID(),
                    );
                    await clients.dh.reply(
                        receivedId,
                        "준비 실패 QA",
                        randomUUID(),
                        "reply",
                        [a.id],
                    );
                    const callsBefore = sends,
                        broken = Object.create(clients.dh);
                    broken.claimEmail = clients.dh.claimEmail.bind(clients.dh);
                    broken.changeEmailDelivery =
                        clients.dh.changeEmailDelivery.bind(clients.dh);
                    broken.downloadEmailDeliveryFile = async () => ({
                        bytes: new Uint8Array([0, 1, 2]).buffer,
                    });
                    const result = await gmail.deliverGmailReply(
                            broken,
                            boxes.dh.id,
                            credentials,
                            transport,
                        ),
                        item = (
                            await db
                                .select()
                                .from(s.inboxEmailDeliveries)
                                .where(
                                    eq(
                                        s.inboxEmailDeliveries.id,
                                        result.deliveryId,
                                    ),
                                )
                        )[0];
                    assert.equal(result.state, "failed");
                    assert.equal(item.attempts, 0);
                    assert.equal(item.errorCode, "attachment_changed");
                    assert.equal(sends, callsBefore);
                    await clients.dh.changeEmailDelivery(item.id, {
                        action: "retry",
                    });
                    assert.equal(
                        (
                            await gmail.deliverGmailReply(
                                clients.dh,
                                boxes.dh.id,
                                credentials,
                                transport,
                            )
                        ).state,
                        "sent",
                    );
                    assert.equal(sends, callsBefore + 1);
                },
            );
            await check(
                "Gmail 외부/인라인 파일·별도 본문·다운로드 실패 뒤 보관된 메일 재시도",
                async () => {
                    const id = "gmail-files-source",
                        badId = "missing-first",
                        body = Buffer.from("별도 다운로드한 메일 본문입니다.");
                    let fail = true;
                    const source = {
                        id,
                        threadId: "gmail-files-thread",
                        internalDate: String(Date.now()),
                        payload: {
                            mimeType: "multipart/mixed",
                            headers: [
                                {
                                    name: "From",
                                    value: "가상 메일 고객 <source@example.test>",
                                },
                                { name: "To", value: boxes.dh.address },
                                {
                                    name: "Message-ID",
                                    value: "<gmail-files@example.test>",
                                },
                                { name: "Subject", value: "Gmail 첨부 확인" },
                            ],
                            parts: [
                                {
                                    mimeType: "text/plain",
                                    body: {
                                        size: body.length,
                                        attachmentId: "text-body",
                                    },
                                },
                                {
                                    partId: "1",
                                    mimeType: "image/png",
                                    filename: "파일 하나.png",
                                    body: {
                                        size: png.length,
                                        attachmentId: longId,
                                    },
                                },
                                {
                                    partId: "2",
                                    mimeType: "application/pdf",
                                    filename: "파일 둘.pdf",
                                    body: {
                                        size: pdf.length,
                                        data: pdf.toString("base64url"),
                                    },
                                },
                                {
                                    partId: "3",
                                    mimeType: "image/png",
                                    filename: "복구할 파일.png",
                                    body: {
                                        size: png.length,
                                        attachmentId: badId,
                                    },
                                },
                            ],
                        },
                    };
                    const fake = async (url) => {
                        const u = String(url);
                        if (u.includes("oauth2"))
                            return Response.json({
                                access_token: "files-fake-access",
                                expires_in: 3600,
                            });
                        if (u.endsWith("profile"))
                            return Response.json({
                                emailAddress: boxes.dh.address,
                            });
                        if (u.includes("messages?"))
                            return Response.json({ messages: [{ id }] });
                        if (u.includes("attachments/")) {
                            const key = decodeURIComponent(
                                u.split("attachments/")[1],
                            );
                            if (key === badId && fail)
                                return new Response("not found", {
                                    status: 404,
                                });
                            const bytes = key === "text-body" ? body : png;
                            return Response.json({
                                size: bytes.length,
                                data: bytes.toString("base64url"),
                            });
                        }
                        return Response.json(source);
                    };
                    const result = await gmail.receiveGmailPage(
                        clients.dh,
                        {
                            workspaceId: 8,
                            mailboxId: boxes.dh.id,
                            since: new Date("2026-10-14"),
                        },
                        credentials,
                        fake,
                    );
                    assert.equal(result.fileFailures.length, 1);
                    const rows = await clients.dh.emailReceiptFiles(
                        result.results[0].receiptId,
                    );
                    assert.deepEqual(
                        rows.map((file) => file.state),
                        ["available", "available", "failed"],
                    );
                    const detail = await repo.conversationDetail(
                        actor,
                        result.results[0].conversationId,
                        db,
                    );
                    assert.equal(detail.messages[0].body, body.toString());
                    fail = false;
                    const retry = await gmail.retryGmailFiles(
                        clients.dh,
                        { workspaceId: 8, mailboxId: boxes.dh.id },
                        credentials,
                        fake,
                    );
                    assert.equal(retry.failures.length, 0);
                    assert.ok(
                        (
                            await clients.dh.emailReceiptFiles(
                                result.results[0].receiptId,
                            )
                        ).every((file) => file.state === "available"),
                    );
                },
            );
            await check(
                "메일함 중지 후 준비 파일 조회/수신 차단과 다시 켠 뒤 복구",
                async () => {
                    const a = await clients.dh.uploadAttachment(
                        receivedId,
                        new Blob([png]),
                        "중지 검증.png",
                        randomUUID(),
                    );
                    await clients.dh.reply(
                        receivedId,
                        "중지할 답장",
                        randomUUID(),
                        "reply",
                        [a.id],
                    );
                    const item = await clients.dh.claimEmail(boxes.dh.id);
                    const box = await clients.dh.changeEmailMailbox(
                        boxes.dh.id,
                        boxes.dh.version,
                        false,
                    );
                    await assert.rejects(
                        clients.dh.downloadEmailDeliveryFile(
                            item.id,
                            a.id,
                            item.leaseToken,
                        ),
                        (e) => e.status === 409,
                    );
                    await assert.rejects(
                        clients.dh.uploadEmailFile(
                            files[0].id,
                            new Blob([png]),
                            "blocked.png",
                        ),
                        (e) => e.status === 409,
                    );
                    boxes.dh = await clients.dh.changeEmailMailbox(
                        box.id,
                        box.version,
                        true,
                    );
                    assert.equal(await clients.dh.claimEmail(box.id), null);
                },
            );
            await check(
                "답장 합계 20MB와 사업 저장 한도·거절 시 초안/메시지 보존",
                async () => {
                    const a = await clients.dh.uploadAttachment(
                            receivedId,
                            new Blob([Buffer.alloc(10 * 1024 * 1024)]),
                            "대용량 하나.bin",
                            randomUUID(),
                        ),
                        b = await clients.dh.uploadAttachment(
                            receivedId,
                            new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)]),
                            "대용량 둘.bin",
                            randomUUID(),
                        ),
                        before = await count(s.inboxMessages);
                    await assert.rejects(
                        clients.dh.reply(
                            receivedId,
                            "합계 제한 QA",
                            randomUUID(),
                            "reply",
                            [a.id, b.id],
                        ),
                        (e) => e.status === 413,
                    );
                    assert.equal(await count(s.inboxMessages), before);
                    const draft = (
                        await db
                            .select()
                            .from(s.inboxAttachments)
                            .where(eq(s.inboxAttachments.id, a.id))
                    )[0];
                    assert.equal(draft.messageId, null);
                    const quota = process.env.INBOX_ATTACHMENT_QUOTA_MB;
                    process.env.INBOX_ATTACHMENT_QUOTA_MB = "20";
                    try {
                        await assert.rejects(
                            clients.dh.uploadAttachment(
                                receivedId,
                                new Blob([png]),
                                "한도 초과.png",
                                randomUUID(),
                            ),
                            (e) => e.status === 413,
                        );
                    } finally {
                        if (quota === undefined)
                            delete process.env.INBOX_ATTACHMENT_QUOTA_MB;
                        else process.env.INBOX_ATTACHMENT_QUOTA_MB = quota;
                    }
                },
            );
            await check(
                "기존 수신 메타데이터 마이그레이션의 파일 대기/제한 복원",
                async () => {
                    const fresh = new pg.constructor();
                    await fresh.waitReady;
                    try {
                        await fresh.exec(
                            "CREATE TABLE inbox_email_receipts(id uuid PRIMARY KEY,message_id integer,envelope jsonb); CREATE TABLE inbox_attachments(id uuid PRIMARY KEY);",
                        );
                        await fresh.query(
                            "INSERT INTO inbox_email_receipts VALUES ($1,1,$2::jsonb),($3,NULL,$2::jsonb)",
                            [
                                randomUUID(),
                                JSON.stringify({
                                    files: [
                                        { size: 64 },
                                        { size: 21 * 1024 * 1024 },
                                        { size: 0 },
                                    ],
                                }),
                                randomUUID(),
                            ],
                        );
                        const sqlText = require("node:fs").readFileSync(
                            require("node:path").resolve(
                                __dirname,
                                "../drizzle/0099_inbox_email_files.sql",
                            ),
                            "utf8",
                        );
                        for (const statement of sqlText.split(
                            "--> statement-breakpoint",
                        ))
                            if (statement.trim()) await fresh.exec(statement);
                        const restored = (
                            await fresh.query(
                                "SELECT file_index,state,error_code FROM inbox_email_files ORDER BY file_index",
                            )
                        ).rows;
                        assert.deepEqual(
                            restored.map((r) => r.state),
                            ["pending", "blocked", "blocked"],
                        );
                        assert.deepEqual(
                            restored.map((r) => r.file_index),
                            [0, 1, 2],
                        );
                    } finally {
                        await fresh.close();
                    }
                },
            );
            await check(
                "100개 미완료 첨부의 원본 번호·커서·사업 격리",
                async () => {
                    for (let n = 0; n < 2; n++)
                        await clients.dh.receiveEmail(
                            boxes.dh.id,
                            input(
                                100 + n,
                                Array.from({ length: 50 }, (_, i) =>
                                    def(
                                        "대기 파일 " + i + ".png",
                                        png,
                                        "part-" + i,
                                    ),
                                ),
                            ),
                        );
                    const first = await clients.dh.pendingEmailFiles(
                            boxes.dh.id,
                        ),
                        second = await clients.dh.pendingEmailFiles(
                            boxes.dh.id,
                            first.rows.at(-1).id,
                        ),
                        third = await clients.dh.pendingEmailFiles(
                            boxes.dh.id,
                            second.rows.at(-1).id,
                        );
                    assert.equal(first.rows.length, 50);
                    assert.equal(second.rows.length, 50);
                    assert.equal(third.rows.length, 0);
                    assert.equal(
                        new Set(
                            [...first.rows, ...second.rows].map(
                                (file) => file.id,
                            ),
                        ).size,
                        100,
                    );
                    assert.ok(
                        first.rows.every((file) =>
                            file.providerMessageId.startsWith("file-mail-"),
                        ),
                    );
                    assert.equal(
                        (await clients.bo.pendingEmailFiles(boxes.bo.id)).rows
                            .length,
                        0,
                    );
                    await assert.rejects(
                        clients.bo.pendingEmailFiles(boxes.dh.id),
                        (e) => e.status === 403,
                    );
                },
            );
            console.log(
                `이메일 첨부 SQL/API QA ${checks}개 통과 · 실제 메일/외부 파일 전송 0건`,
            );
            if (extra)
                await extra({
                    ...ctx,
                    attachmentConversationId: receivedId,
                    emailMailboxes: boxes,
                });
            else await pg.close();
        } catch (error) {
            throw error;
        }
    });
}
if (require.main === module)
    runEmailFilesCheck().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
module.exports = { runEmailFilesCheck };
