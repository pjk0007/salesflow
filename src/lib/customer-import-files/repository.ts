import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
    db,
    customerImportFiles as tasks,
    customerImportObjects as keys,
    customerImportResults as results,
    customerImportAudit as audit,
    inboxMessages as messages,
    inboxConversations as chats,
    inboxChannels as channels,
    inboxAttachments as files,
    inboxAttachmentBlobs as blobs,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { importOwned } from "@/lib/customer-imports/repository";
import { fingerprint } from "@/lib/customer-imports/rules";
import { lockWorkflowWorkspace } from "@/lib/customer-workflows/repository";
import {
    attachmentQuotaBytes,
    fileName,
    fileOwner,
    safeContentType,
    MAX_FILE_BYTES,
} from "@/lib/inbox/files";
import { InboxError } from "@/lib/inbox/errors";
import { registerImportFiles } from "./registry";
import { sourceFileUrl } from "./rules";
import {
    fetchImportFile,
    FileFetchError,
    type ImportFileTransport,
} from "./transport";
type Task = typeof tasks.$inferSelect;
function safe(task: Task) {
    const { sourceUrl, leaseToken: _, ...value } = task;
    void _;
    return {
        ...value,
        sourceHost: sourceUrl ? new URL(sourceUrl).hostname : null,
        interrupted:
            task.state === "fetching" &&
            (!task.leaseUntil || task.leaseUntil <= new Date()),
    };
}
async function transaction<T>(
    actor: SalesActor,
    jobId: string,
    exec: DbExec,
    fn: (
        tx: DbExec,
        job: Awaited<ReturnType<typeof importOwned>>,
    ) => Promise<T>,
) {
    const preliminary = await importOwned(actor, jobId, exec);
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, preliminary.workspaceId, tx);
        return fn(tx, await importOwned(actor, jobId, tx, true));
    });
}
async function taskOwned(
    actor: SalesActor,
    jobId: string,
    id: string,
    tx: DbExec,
) {
    const [task] = await tx
        .select()
        .from(tasks)
        .where(
            and(
                eq(tasks.id, id),
                eq(tasks.jobId, jobId),
                eq(tasks.orgId, actor.orgId),
            ),
        )
        .for("update");
    if (!task) throw new InboxError("이전 파일을 찾을 수 없습니다.", 404);
    if (!task.active)
        throw new InboxError(
            "새 원본에서 제외되거나 바뀐 파일입니다. 현재 이전 작업을 확인해주세요.",
            409,
        );
    return task;
}
function editable(task: Task, version: number) {
    if (task.version !== version)
        throw new InboxError(
            "파일 상태가 바뀌었습니다. 목록을 새로고침해주세요.",
            409,
        );
    if (
        task.state === "fetching" &&
        task.leaseUntil &&
        task.leaseUntil > new Date()
    )
        throw new InboxError(
            "이 파일을 가져오고 있습니다. 잠시 후 확인해주세요.",
            409,
        );
    if (!task.metadataValid)
        throw new InboxError(
            "원본의 크기·SHA-256 정보를 수정해서 자료를 다시 가져와주세요.",
            409,
        );
}
export async function importFilePage(
    actor: SalesActor,
    jobId: string,
    offset = 0,
    exec: DbExec = db,
) {
    await importOwned(actor, jobId, exec);
    const where = and(eq(tasks.orgId, actor.orgId), eq(tasks.jobId, jobId));
    const rows = await exec
        .select()
        .from(tasks)
        .where(where)
        .orderBy(tasks.id)
        .limit(100)
        .offset(offset);
    const counts = await exec
        .select({
            state: tasks.state,
            active: tasks.active,
            count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(tasks)
        .where(where)
        .groupBy(tasks.state, tasks.active);
    const total = counts.reduce((n, row) => n + row.count, 0);
    return {
        rows: rows.map(safe),
        counts,
        total,
        offset,
        hasMore: offset + rows.length < total,
    };
}
/** Backfill registry for already applied metadata, without reactivating superseded exports. */
export async function prepareImportFiles(
    actor: SalesActor,
    jobId: string,
    offset: number,
    exec: DbExec = db,
) {
    return transaction(actor, jobId, exec, async (tx, job) => {
        const page = job.plan.slice(offset, offset + 100),
            scope = {
                orgId: actor.orgId,
                workspaceId: job.workspaceId,
                source: job.input.source,
                namespace: job.namespace,
            };
        const saved = page.length
            ? await tx
                  .select()
                  .from(results)
                  .where(
                      and(
                          eq(results.jobId, jobId),
                          inArray(
                              results.position,
                              page.map((p) => p.index),
                          ),
                      ),
                  )
            : [];
        let skipped = 0;
        for (const row of page.filter((r) => r.kind === "messages")) {
            const result = saved.find((r) => r.position === row.index);
            if (!result) continue;
            const [key] = await tx
                .select()
                .from(keys)
                .where(
                    and(
                        eq(keys.workspaceId, job.workspaceId),
                        eq(keys.source, job.source),
                        eq(keys.namespace, job.namespace),
                        eq(keys.kind, "messages"),
                        eq(keys.sourceId, row.sourceId),
                    ),
                );
            if (
                !key ||
                key.targetId !== result.targetId ||
                key.sourceFingerprint !==
                    fingerprint({ data: row.data, original: row.original })
            ) {
                skipped++;
                continue;
            }
            await registerImportFiles(
                scope,
                jobId,
                row,
                Number(result.targetId),
                tx,
            );
        }
        return {
            nextOffset: offset + page.length,
            total: job.plan.length,
            hasMore: offset + page.length < job.plan.length,
            skipped,
        };
    });
}
export async function refreshImportFileSource(
    actor: SalesActor,
    jobId: string,
    id: string,
    version: number,
    rawUrl: string,
    exec: DbExec = db,
) {
    const url = sourceFileUrl(rawUrl);
    return transaction(actor, jobId, exec, async (tx) => {
        const task = await taskOwned(actor, jobId, id, tx);
        editable(task, version);
        if (task.state === "ready") return safe(task);
        const [updated] = await tx
            .update(tasks)
            .set({
                sourceUrl: url,
                state: "pending",
                error: null,
                leaseToken: null,
                leaseUntil: null,
                version: task.version + 1,
                updatedAt: new Date(),
            })
            .where(eq(tasks.id, id))
            .returning();
        await tx.insert(audit).values({
            jobId,
            actorName: actor.name,
            action: "file.source",
            detail: { fileId: id, host: new URL(url).hostname },
        });
        return safe(updated);
    });
}
async function claim(
    actor: SalesActor,
    jobId: string,
    id: string,
    version: number,
    upload: boolean,
    exec: DbExec,
) {
    return transaction(actor, jobId, exec, async (tx) => {
        const task = await taskOwned(actor, jobId, id, tx);
        if (task.state === "ready") return task;
        editable(task, version);
        if (!upload && !task.sourceUrl)
            throw new InboxError(
                "새 원본 주소를 입력하거나 파일을 보충해주세요.",
                409,
            );
        const [claimed] = await tx
            .update(tasks)
            .set({
                state: "fetching",
                leaseToken: randomUUID(),
                leaseUntil: new Date(Date.now() + 60000),
                attempts: task.attempts + 1,
                version: task.version + 1,
                error: null,
                updatedAt: new Date(),
            })
            .where(eq(tasks.id, id))
            .returning();
        return claimed;
    });
}
async function save(
    actor: SalesActor,
    jobId: string,
    claimed: Task,
    bytes: Buffer,
    exec: DbExec,
) {
    if (!bytes.length || bytes.length > MAX_FILE_BYTES)
        throw new InboxError(
            "파일은 0바이트보다 크고 20MB 이하여야 합니다.",
            413,
        );
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (claimed.expectedSize !== null && claimed.expectedSize !== bytes.length)
        throw new InboxError(
            "원본 정보의 파일 크기와 다릅니다. 파일 또는 원본 정보를 확인해주세요.",
            409,
        );
    if (claimed.expectedSha256 && claimed.expectedSha256 !== digest)
        throw new InboxError(
            "원본 정보의 SHA-256과 다릅니다. 올바른 파일을 선택해주세요.",
            409,
        );
    return transaction(actor, jobId, exec, async (tx, job) => {
        const task = await taskOwned(actor, jobId, claimed.id, tx);
        if (
            task.leaseToken !== claimed.leaseToken ||
            task.version !== claimed.version ||
            task.state !== "fetching"
        )
            throw new InboxError(
                "파일 이전 요청이 바뀌었습니다. 현재 상태를 확인해주세요.",
                409,
            );
        const [relation] = await tx
            .select({ message: messages, chat: chats })
            .from(messages)
            .innerJoin(chats, eq(chats.id, messages.conversationId))
            .innerJoin(channels, eq(channels.id, chats.channelId))
            .where(
                and(
                    eq(messages.id, task.messageId),
                    eq(chats.orgId, actor.orgId),
                    eq(channels.workspaceId, job.workspaceId),
                ),
            );
        if (!relation?.chat.historyOnly)
            throw new InboxError(
                "과거 상담의 원본 파일에만 사용할 수 있습니다.",
                409,
            );
        await tx
            .select({ id: channels.id })
            .from(channels)
            .where(eq(channels.id, relation.chat.channelId))
            .for("update");
        const [usage] = await tx
            .select({
                bytes: sql<number>`coalesce(sum(${files.size}),0)`.mapWith(
                    Number,
                ),
            })
            .from(files)
            .where(
                and(
                    eq(files.channelId, relation.chat.channelId),
                    isNull(files.cancelledAt),
                ),
            );
        if (usage.bytes + bytes.length > attachmentQuotaBytes())
            throw new InboxError(
                "이 사업의 상담 파일 저장 한도에 도달했습니다.",
                413,
            );
        const [attachment] = await tx
            .insert(files)
            .values({
                orgId: actor.orgId,
                channelId: relation.chat.channelId,
                messageId: task.messageId,
                ownerKey: fileOwner(`import:${task.messageId}`),
                clientId: task.id,
                kind: relation.message.kind,
                fileName: task.fileName,
                contentType: safeContentType(bytes),
                size: bytes.length,
                sha256: digest,
                importMetadata: {
                    taskId: task.id,
                    source: job.source,
                    previousSource: false,
                },
            })
            .returning({ id: files.id });
        await tx.insert(blobs).values({ attachmentId: attachment.id, bytes });
        const [ready] = await tx
            .update(tasks)
            .set({
                state: "ready",
                sourceUrl: null,
                attachmentId: attachment.id,
                leaseToken: null,
                leaseUntil: null,
                error: null,
                version: task.version + 1,
                updatedAt: new Date(),
            })
            .where(eq(tasks.id, task.id))
            .returning();
        await tx.insert(audit).values({
            jobId,
            actorName: actor.name,
            action: "file.ready",
            detail: {
                fileId: task.id,
                attachmentId: attachment.id,
                bytes: bytes.length,
                sha256: digest,
            },
        });
        return safe(ready);
    });
}
export async function transferImportFile(
    actor: SalesActor,
    jobId: string,
    id: string,
    version: number,
    options: {
        bytes?: Buffer;
        fileName?: string;
        transport?: ImportFileTransport;
    } = {},
    exec: DbExec = db,
) {
    const task = await claim(
        actor,
        jobId,
        id,
        version,
        options.bytes !== undefined,
        exec,
    );
    if (task.state === "ready") return safe(task);
    try {
        if (
            options.fileName !== undefined &&
            fileName(options.fileName) !== task.fileName
        )
            throw new InboxError(
                "원본 첨부와 같은 이름의 파일을 선택해주세요.",
                409,
            );
        const bytes =
            options.bytes ??
            (await (options.transport ?? fetchImportFile)(task.sourceUrl!));
        return await save(actor, jobId, task, bytes, exec);
    } catch (error) {
        // Never persist network error text: signed URLs may be present in an upstream error.
        const reason =
            error instanceof FileFetchError || error instanceof InboxError
                ? error.message
                : "파일을 가져오지 못했습니다. 주소 또는 파일을 확인하고 다시 시도해주세요.";
        await exec.transaction(async (tx) => {
            const [failed] = await tx
                .update(tasks)
                .set({
                    state:
                        error instanceof FileFetchError && error.needsSource
                            ? "needs_source"
                            : "failed",
                    leaseToken: null,
                    leaseUntil: null,
                    error: reason.slice(0, 500),
                    version: task.version + 1,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(tasks.id, task.id),
                        eq(tasks.leaseToken, task.leaseToken!),
                        eq(tasks.version, task.version),
                    ),
                )
                .returning({ id: tasks.id });
            if (failed)
                await tx.insert(audit).values({
                    jobId,
                    actorName: actor.name,
                    action: "file.failed",
                    detail: { fileId: task.id, reason },
                });
        });
        // Refreshing the list shows the durable failure and its recovery actions.
        throw new InboxError(
            reason,
            error instanceof InboxError ? error.status : 502,
        );
    }
}
