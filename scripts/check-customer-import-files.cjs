/* eslint-disable @typescript-eslint/no-require-imports -- 가상 원본·격리 PostgreSQL의 첨부 이전 QA */
const assert = require("node:assert/strict"),
    { randomUUID, createHash } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function scenario(ctx) {
    const {
            db,
            pg,
            actor,
            otherActor,
            clients,
            repo,
            channels,
            dispatch,
            keys,
        } = ctx,
        s = require("../src/lib/db/schema.ts"),
        { eq, sql } = require("drizzle-orm"),
        files = require("../src/lib/customer-import-files/repository.ts"),
        {
            FileFetchError,
        } = require("../src/lib/customer-import-files/transport.ts");
    const pdf = Buffer.from("%PDF-1.4\nSendb fictional migration QA\n%%EOF"),
        png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPd8AAAAASUVORK5CYII=",
            "base64",
        ),
        digest = (bytes) => createHash("sha256").update(bytes).digest("hex"),
        descriptor = (id, name, bytes, extra = {}) => ({
            id,
            name,
            size: bytes.length,
            sha256: digest(bytes),
            ...extra,
        });
    const bundle = {
        contacts: [{ id: "c", name: "첨부 이전 가상 고객" }],
        conversations: [
            {
                id: "chat",
                contactId: "c",
                name: "첨부 이전 가상 상담",
                createdAt: "2024-01-01T00:00:00.000Z",
            },
        ],
        messages: [
            {
                id: "m",
                conversationId: "chat",
                authorName: "가상 고객",
                body: "이전 문의와 제안서",
                messageKind: "customer",
                createdAt: "2024-01-01T00:01:00.000Z",
                files: [
                    descriptor("pdf", "가상 제안서.pdf", pdf, {
                        url: "https://files.example.test/proposal?signature=fictional-old",
                    }),
                ],
            },
            {
                id: "n",
                conversationId: "chat",
                authorName: "가상 직원",
                body: "내부 이미지 메모",
                messageKind: "note",
                createdAt: "2024-01-01T00:02:00.000Z",
                files: [descriptor("png", "가상 메모.png", png)],
            },
        ],
    };
    async function complete(
        data = bundle,
        namespace = "file-migration-qa",
        options = {},
        client = clients.dh,
    ) {
        let job = await client.previewImport({
            workspaceId: 8,
            source: "portable",
            namespace,
            format: "json",
            content: JSON.stringify(data),
            updateImported: true,
            ...options,
        });
        assert.deepEqual(job.errors, []);
        job = await client.changeImport(job.id, {
            action: "start",
            version: job.version,
            fingerprint: job.fingerprint,
            acknowledge: true,
        });
        while (job.state === "running")
            job = await client.stepImport(job.id, job.cursor);
        assert.equal(job.state, "completed", job.reason);
        return job;
    }
    const count = async (table) =>
        (await db.select({ n: sql`count(*)`.mapWith(Number) }).from(table))[0]
            .n;
    let checks = 0,
        job,
        pdfTask,
        noteTask,
        archiveId;
    const check = async (name, fn) => {
        await fn();
        console.log(`PASS IMPORT FILE ${++checks} ${name}`);
    };
    const task = async (id) =>
        (
            await db
                .select()
                .from(s.customerImportFiles)
                .where(eq(s.customerImportFiles.id, id))
        )[0];
    const transfer = (t, options) =>
        files.transferImportFile(actor, t.jobId, t.id, t.version, options, db);
    await check(
        "미리보기는 파일·바이트를 만들지 않고 실제 적용 시 첨부 목록만 등록",
        async () => {
            assert.equal(await count(s.customerImportFiles), 0);
            job = await complete();
            const page = await clients.dh.importFiles(job.id);
            assert.equal(page.total, 2);
            pdfTask = page.rows.find((r) => r.fileName.endsWith("pdf"));
            noteTask = page.rows.find((r) => r.fileName.endsWith("png"));
            assert.equal(pdfTask.state, "pending");
            assert.equal(noteTask.state, "needs_source");
            assert.equal(await count(s.inboxAttachmentBlobs), 0);
            archiveId = (
                await repo.conversationDetail(
                    actor,
                    (
                        await db
                            .select()
                            .from(s.inboxMessages)
                            .where(eq(s.inboxMessages.id, pdfTask.messageId))
                    )[0].conversationId,
                    db,
                )
            ).conversation.id;
        },
    );
    await check(
        "목록은 서명 주소·임대 토큰 없이 원본 키·호스트·상태만 반환",
        async () => {
            const text = JSON.stringify(await clients.dh.importFiles(job.id));
            assert.ok(!text.includes("fictional-old"));
            assert.ok(!text.includes("sourceUrl"));
            assert.ok(!text.includes("leaseToken"));
            assert.ok(text.includes("files.example.test"));
        },
    );
    await check("사업/조직/읽기 전용 키와 직원 인증 검증", async () => {
        await assert.rejects(
            clients.bo.importFiles(job.id),
            (e) => e.status === 403,
        );
        await assert.rejects(
            clients.read.fetchImportFile(job.id, pdfTask.id, pdfTask.version),
            (e) => e.status === 403,
        );
        assert.equal((await clients.read.importFiles(job.id)).total, 2);
        await assert.rejects(
            files.importFilePage(otherActor, job.id, 0, db),
            (e) => e.status === 404,
        );
        assert.equal(
            (
                await dispatch(
                    `http://127.0.0.1:3120/api/customer-imports/${job.id}/files`,
                )
            ).status,
            401,
        );
    });
    await check(
        "파일 실제 바이트·SHA256 저장 후 SDK 다운로드와 상담 첨부로 연결",
        async () => {
            pdfTask = await transfer(pdfTask, {
                transport: async (url) => {
                    assert.ok(url.includes("fictional-old"));
                    return pdf;
                },
            });
            assert.equal(pdfTask.state, "ready");
            const response = await clients.dh.downloadAttachment(
                pdfTask.attachmentId,
            );
            assert.deepEqual(Buffer.from(response.bytes), pdf);
            assert.equal(response.contentType, "application/pdf");
            const detail = await repo.conversationDetail(actor, archiveId, db);
            assert.equal(
                detail.messages.find((m) => m.id === pdfTask.messageId)
                    .attachments[0].id,
                pdfTask.attachmentId,
            );
            assert.equal((await task(pdfTask.id)).sourceUrl, null);
        },
    );
    await check(
        "완료 파일 재요청은 네트워크·중복 바이트를 만들지 않음",
        async () => {
            const before = await count(s.inboxAttachmentBlobs);
            assert.equal(
                (await clients.dh.fetchImportFile(job.id, pdfTask.id, 1))
                    .attachmentId,
                pdfTask.attachmentId,
            );
            assert.equal(await count(s.inboxAttachmentBlobs), before);
        },
    );
    await check(
        "원본 주소 없는 파일은 이름·크기·해시 검증 후 multipart SDK로 보충",
        async () => {
            await assert.rejects(
                clients.dh.uploadImportFile(
                    job.id,
                    noteTask.id,
                    noteTask.version,
                    new Blob([png]),
                    "다른 이름.png",
                ),
                (e) => e.status === 409,
            );
            noteTask = await task(noteTask.id);
            noteTask = await clients.dh.uploadImportFile(
                job.id,
                noteTask.id,
                noteTask.version,
                new Blob([png]),
                "가상 메모.png",
            );
            assert.equal(noteTask.state, "ready");
            assert.deepEqual(
                Buffer.from(
                    (await clients.dh.downloadAttachment(noteTask.attachmentId))
                        .bytes,
                ),
                png,
            );
        },
    );
    await check(
        "과거 내부 메모 파일은 고객 다운로드·다른 사업에서 접근 불가",
        async () => {
            await assert.rejects(
                clients.bo.downloadAttachment(noteTask.attachmentId),
                (e) => [403, 404].includes(e.status),
            );
            await assert.rejects(
                require("../src/lib/inbox/files.ts").downloadAttachment(
                    {
                        orgId: actor.orgId,
                        channelId: channels.dh.id,
                        conversationId: archiveId,
                        ownerKey: "fake",
                        publicOnly: true,
                    },
                    noteTask.attachmentId,
                    db,
                ),
                (e) => e.status === 404,
            );
            const identity = await clients.dh.customerIdentity(
                channels.dh.id,
                ctx.contacts.dh.id,
            );
            const response = await dispatch(
                `http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}/attachments/${pdfTask.attachmentId}`,
                {
                    headers: {
                        Authorization: `Bearer ${identity.identityToken}`,
                    },
                },
            );
            assert.equal(response.status, 404);
        },
    );
    let recoveryJob, recoveryTask;
    await check(
        "만료된 원본 주소는 needs_source로 저장하고 주소 갱신은 버전 충돌 방지",
        async () => {
            recoveryJob = await complete(bundle, "file-recovery");
            recoveryTask = (
                await clients.dh.importFiles(recoveryJob.id)
            ).rows.find((r) => r.fileName.endsWith("pdf"));
            await assert.rejects(
                transfer(recoveryTask, {
                    transport: async () => {
                        throw new FileFetchError(
                            "원본 파일 응답 403. 새 주소를 확인해주세요.",
                            true,
                        );
                    },
                }),
                (e) => e.status === 502,
            );
            const failed = await task(recoveryTask.id);
            assert.equal(failed.state, "needs_source");
            await assert.rejects(
                clients.dh.refreshImportFileSource(
                    recoveryJob.id,
                    failed.id,
                    recoveryTask.version,
                    "https://files.example.test/new?signature=fake-new",
                ),
                (e) => e.status === 409,
            );
            recoveryTask = await clients.dh.refreshImportFileSource(
                recoveryJob.id,
                failed.id,
                failed.version,
                "https://files.example.test/new?signature=fake-new",
            );
            assert.equal(recoveryTask.state, "pending");
            assert.equal(recoveryTask.sourceHost, "files.example.test");
            assert.ok(
                !JSON.stringify(
                    await clients.dh.import(recoveryJob.id),
                ).includes("fake-new"),
            );
        },
    );
    await check(
        "크기·해시 불일치는 바이트 저장 없이 복구 가능한 실패로 기록",
        async () => {
            const before = await count(s.inboxAttachmentBlobs);
            await assert.rejects(
                transfer(recoveryTask, {
                    bytes: Buffer.from("bad"),
                    fileName: recoveryTask.fileName,
                }),
                (e) => e.status === 409,
            );
            recoveryTask = await task(recoveryTask.id);
            await assert.rejects(
                transfer(recoveryTask, {
                    bytes: Buffer.alloc(pdf.length, 1),
                    fileName: recoveryTask.fileName,
                }),
                (e) => e.status === 409,
            );
            recoveryTask = await task(recoveryTask.id);
            assert.equal(recoveryTask.state, "failed");
            assert.equal(await count(s.inboxAttachmentBlobs), before);
        },
    );
    await check(
        "동시에 같은 파일을 가져와도 임대 한 개·바이트 한 개만 저장",
        async () => {
            let started, release;
            const reached = new Promise((r) => {
                    started = r;
                }),
                wait = new Promise((r) => {
                    release = r;
                });
            const first = transfer(recoveryTask, {
                transport: async () => {
                    started();
                    await wait;
                    return pdf;
                },
            });
            await reached;
            await assert.rejects(
                transfer(recoveryTask, {
                    bytes: pdf,
                    fileName: recoveryTask.fileName,
                }),
                (e) => e.status === 409,
            );
            const during = await task(recoveryTask.id);
            await assert.rejects(
                clients.dh.refreshImportFileSource(
                    recoveryJob.id,
                    during.id,
                    during.version,
                    "https://files.example.test/other",
                ),
                (e) => e.status === 409,
            );
            release();
            recoveryTask = await first;
            assert.equal(recoveryTask.state, "ready");
        },
    );
    await check(
        "중단된 임대는 만료 뒤 재시도하여 저장 위치에서 복구",
        async () => {
            const t = (await clients.dh.importFiles(recoveryJob.id)).rows.find(
                (r) => r.fileName.endsWith("png"),
            );
            await db
                .update(s.customerImportFiles)
                .set({
                    state: "fetching",
                    leaseToken: randomUUID(),
                    leaseUntil: new Date(0),
                })
                .where(eq(s.customerImportFiles.id, t.id));
            const expired = (
                await clients.dh.importFiles(recoveryJob.id)
            ).rows.find((r) => r.id === t.id);
            assert.equal(expired.interrupted, true);
            assert.equal(
                (
                    await clients.dh.uploadImportFile(
                        recoveryJob.id,
                        t.id,
                        t.version,
                        new Blob([png]),
                        t.fileName,
                    )
                ).state,
                "ready",
            );
        },
    );
    const rotated = structuredClone(bundle);
    await check(
        "서명 주소만 갱신한 재이전은 완료 바이트를 그대로 재사용",
        async () => {
            rotated.messages[0].files[0].url =
                "https://files.example.test/proposal?signature=rotated";
            const before = await count(s.inboxAttachmentBlobs);
            job = await complete(rotated);
            const rows = (await clients.dh.importFiles(job.id)).rows;
            assert.equal(
                rows.find((r) => r.fileName.endsWith("pdf")).attachmentId,
                pdfTask.attachmentId,
            );
            assert.equal(await count(s.inboxAttachmentBlobs), before);
        },
    );
    const changed = structuredClone(rotated);
    await check(
        "파일 정보 변경은 새 버전으로 이전하고 이전 파일 바이트도 보존",
        async () => {
            changed.messages[0].files[0].name = "가상 제안서 수정.pdf";
            job = await complete(changed);
            const newTask = (await clients.dh.importFiles(job.id)).rows.find(
                (r) => r.fileName.includes("수정"),
            );
            const saved = await clients.dh.uploadImportFile(
                job.id,
                newTask.id,
                newTask.version,
                new Blob([pdf]),
                newTask.fileName,
            );
            assert.notEqual(saved.attachmentId, pdfTask.attachmentId);
            const detail = await repo.conversationDetail(actor, archiveId, db),
                attached = detail.messages.find(
                    (m) => m.id === pdfTask.messageId,
                ).attachments;
            assert.equal(attached.length, 2);
            assert.equal(
                attached.find((f) => f.id === pdfTask.attachmentId)
                    .importMetadata.previousSource,
                true,
            );
            assert.deepEqual(
                Buffer.from(
                    (await clients.dh.downloadAttachment(pdfTask.attachmentId))
                        .bytes,
                ),
                pdf,
            );
        },
    );
    await check(
        "이전 작업 목록 재준비로 오래된 원본을 다시 활성화하지 않음",
        async () => {
            const originalJob = (await task(pdfTask.id)).jobId;
            const prepared = await clients.dh.prepareImportFiles(originalJob);
            assert.ok(prepared.skipped >= 1);
            assert.equal((await task(pdfTask.id)).active, false);
        },
    );
    await check(
        "원본에서 첨부 제거 후에도 바이트·이전 표시·용량 집계 보존",
        async () => {
            const removed = structuredClone(changed);
            removed.messages[0].files = [];
            await complete(removed);
            const detail = await repo.conversationDetail(actor, archiveId, db),
                attached = detail.messages.find(
                    (m) => m.id === pdfTask.messageId,
                ).attachments;
            assert.equal(attached.length, 2);
            assert.ok(attached.every((f) => f.importMetadata.previousSource));
            assert.equal(
                (
                    await db
                        .select()
                        .from(s.inboxAttachments)
                        .where(eq(s.inboxAttachments.id, pdfTask.attachmentId))
                )[0].cancelledAt,
                null,
            );
            await assert.rejects(
                transfer(await task(pdfTask.id), { bytes: pdf }),
                (e) => e.status === 409,
            );
        },
    );
    await check(
        "동일 원본 재추가는 이전 바이트를 재사용하고 현재 파일로 복구",
        async () => {
            const before = await count(s.inboxAttachmentBlobs);
            job = await complete(bundle);
            assert.equal((await task(pdfTask.id)).active, true);
            assert.equal(await count(s.inboxAttachmentBlobs), before);
            const detail = await repo.conversationDetail(actor, archiveId, db);
            assert.equal(
                detail.messages
                    .find((m) => m.id === pdfTask.messageId)
                    .attachments.find((f) => f.id === pdfTask.attachmentId)
                    .importMetadata.previousSource,
                false,
            );
        },
    );
    await check(
        "서버 다운로드 중 새 원본 이전 시 오래된 다운로드 결과는 저장하지 않음",
        async () => {
            const movingJob = await complete(bundle, "file-moving"),
                t = (await clients.dh.importFiles(movingJob.id)).rows.find(
                    (r) => r.fileName.endsWith("pdf"),
                );
            let started, release;
            const reached = new Promise((r) => {
                    started = r;
                }),
                wait = new Promise((r) => {
                    release = r;
                });
            const first = transfer(t, {
                transport: async () => {
                    started();
                    await wait;
                    return pdf;
                },
            }).then(
                () => null,
                (e) => e,
            );
            await reached;
            await complete(changed, "file-moving");
            release();
            assert.equal((await first).status, 409);
            assert.equal((await task(t.id)).active, false);
            assert.equal((await task(t.id)).attachmentId, null);
        },
    );
    await check(
        "잘못된 크기·해시 정보는 임의 파일 보충으로 우회하지 않음",
        async () => {
            const invalid = structuredClone(bundle);
            invalid.messages[0].files[0].sha256 = "broken";
            const invalidJob = await complete(invalid, "file-invalid"),
                t = (await clients.dh.importFiles(invalidJob.id)).rows.find(
                    (r) => r.fileName.endsWith("pdf"),
                );
            assert.equal(t.metadataValid, false);
            await assert.rejects(
                transfer(t, { bytes: pdf }),
                (e) => e.status === 409,
            );
        },
    );
    await check(
        "이전 버전에서 가져온 메시지는 명시적 준비로 첨부 목록 복구",
        async () => {
            const legacyJob = await complete(bundle, "file-legacy");
            await db
                .delete(s.customerImportFiles)
                .where(eq(s.customerImportFiles.jobId, legacyJob.id));
            assert.equal((await clients.dh.importFiles(legacyJob.id)).total, 0);
            const prepared = await clients.dh.prepareImportFiles(legacyJob.id);
            assert.equal(prepared.hasMore, false);
            assert.equal((await clients.dh.importFiles(legacyJob.id)).total, 2);
        },
    );
    await check("파일 용량 한도에는 보존한 이전 원본도 포함", async () => {
        const quotaJob = await complete(bundle, "file-quota"),
            t = (await clients.dh.importFiles(quotaJob.id)).rows.find((r) =>
                r.fileName.endsWith("pdf"),
            ),
            previous = process.env.INBOX_ATTACHMENT_QUOTA_MB;
        const [charge] = await db
            .insert(s.inboxAttachments)
            .values({
                orgId: actor.orgId,
                channelId: channels.dh.id,
                ownerKey: "f".repeat(64),
                clientId: randomUUID(),
                kind: "note",
                fileName: "가상 용량 fixture",
                contentType: "application/octet-stream",
                size: 20971520,
                sha256: "a".repeat(64),
            })
            .returning();
        process.env.INBOX_ATTACHMENT_QUOTA_MB = "20";
        try {
            await assert.rejects(
                transfer(t, { bytes: pdf }),
                (e) => e.status === 413,
            );
        } finally {
            if (previous === undefined)
                delete process.env.INBOX_ATTACHMENT_QUOTA_MB;
            else process.env.INBOX_ATTACHMENT_QUOTA_MB = previous;
            await db
                .delete(s.inboxAttachments)
                .where(eq(s.inboxAttachments.id, charge.id));
        }
        assert.equal((await task(t.id)).state, "failed");
    });
    await check(
        "100개 첨부 제한을 조용히 잘라내지 않고 파일 목록 100건 커서 제공",
        async () => {
            const many = structuredClone(bundle);
            many.messages[0].files = Array.from({ length: 100 }, (_, i) =>
                descriptor("f" + i, "파일" + i + ".pdf", pdf),
            );
            const manyJob = await complete(many, "file-many");
            const first = await clients.dh.importFiles(manyJob.id),
                second = await clients.dh.importFiles(manyJob.id, 100);
            assert.equal(first.rows.length, 100);
            assert.equal(first.hasMore, true);
            assert.equal(first.total, 101);
            assert.equal(second.rows.length, 1);
            assert.equal(second.hasMore, false);
        },
    );
    await check(
        "이전 파일 복구는 새 메시지·고객 알림·AI·자동화를 만들지 않음",
        async () => {
            assert.equal(await count(s.customerAiJobs), 0);
            assert.equal(await count(s.customerWorkflowRuns), 0);
            const original = (
                await db
                    .select()
                    .from(s.inboxMessages)
                    .where(eq(s.inboxMessages.id, pdfTask.messageId))
            )[0];
            assert.equal(original.body, bundle.messages[0].body);
            assert.equal(
                original.createdAt.toISOString(),
                bundle.messages[0].createdAt,
            );
            assert.equal(
                (await clients.dh.import(job.id)).audit.some(
                    (a) =>
                        a.action === "file.source" &&
                        JSON.stringify(a.detail).includes("signature"),
                ),
                false,
            );
        },
    );
    await check(
        "백오피스랩도 같은 원본 ID를 별도 사업에 이전·보충·다운로드",
        async () => {
            const boJob = await complete(
                bundle,
                "file-migration-qa",
                { workspaceId: 10 },
                clients.bo,
            );
            const row = (await clients.bo.importFiles(boJob.id)).rows.find(
                (r) => r.fileName.endsWith("pdf"),
            );
            const saved = await clients.bo.uploadImportFile(
                boJob.id,
                row.id,
                row.version,
                new Blob([pdf]),
                row.fileName,
            );
            assert.notEqual(row.messageId, pdfTask.messageId);
            assert.deepEqual(
                Buffer.from(
                    (await clients.bo.downloadAttachment(saved.attachmentId))
                        .bytes,
                ),
                pdf,
            );
            await assert.rejects(
                clients.dh.downloadAttachment(saved.attachmentId),
                (e) => [403, 404].includes(e.status),
            );
        },
    );
    // keys stay in memory and are never emitted.
    void keys;
    console.log(
        `첨부 원본 이전 ${process.argv.includes("--postgres") ? "PostgreSQL" : "PGlite"} QA ${checks}개 통과 · 가상 데이터·원본 서비스 접근/외부 발송 0건`,
    );
    await pg.close();
}
(process.argv.includes("--postgres")
    ? require("./customer-platform-test-postgres.cjs").runPostgresPlatformCheck(
          scenario,
      )
    : runPlatformCheck(scenario)
).catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
