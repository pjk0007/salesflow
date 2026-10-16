import { eq, sql } from "drizzle-orm";
import {
    customerImportFiles as tasks,
    inboxAttachments as files,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { ImportScope } from "@/lib/customer-imports/storage";
import type { ImportPlanRow } from "@/lib/customer-imports/rules";
import { fileDescriptors } from "./rules";

/** Called in the metadata import transaction, without network access. */
export async function registerImportFiles(
    scope: ImportScope,
    jobId: string,
    row: ImportPlanRow,
    messageId: number,
    tx: DbExec,
) {
    const prior = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.messageId, messageId))
        .for("update");
    const descriptors = fileDescriptors(row.data.files);
    for (const old of prior) {
        if (
            descriptors.some(
                (d) =>
                    d.sourceKey === old.sourceKey &&
                    d.manifest === old.manifest,
            )
        )
            continue;
        if (old.active)
            await tx
                .update(tasks)
                .set({
                    active: false,
                    version: sql`${tasks.version}+1`,
                    leaseToken: null,
                    leaseUntil: null,
                    updatedAt: new Date(),
                })
                .where(eq(tasks.id, old.id));
        if (old.attachmentId)
            await tx
                .update(files)
                .set({
                    importMetadata: {
                        taskId: old.id,
                        source: scope.source,
                        previousSource: true,
                    },
                })
                .where(eq(files.id, old.attachmentId));
    }
    for (const d of descriptors) {
        const old = prior.find(
            (t) => t.sourceKey === d.sourceKey && t.manifest === d.manifest,
        );
        if (old) {
            // Reconciliation invalidates an in-flight lease; ready bytes remain reusable.
            const ready = old.state === "ready" && !!old.attachmentId;
            await tx
                .update(tasks)
                .set({
                    jobId,
                    active: true,
                    metadataValid: !d.invalid,
                    version: sql`${tasks.version}+1`,
                    state: ready
                        ? "ready"
                        : d.invalid
                          ? "failed"
                          : d.url
                            ? "pending"
                            : "needs_source",
                    sourceUrl: ready ? null : d.url,
                    error: ready
                        ? null
                        : d.invalid
                          ? "원본 파일의 크기 또는 SHA-256 정보를 확인해주세요."
                          : d.url
                            ? null
                            : "원본 서비스에서 새 파일 주소를 받거나 파일을 보충해주세요.",
                    leaseToken: null,
                    leaseUntil: null,
                    updatedAt: new Date(),
                })
                .where(eq(tasks.id, old.id));
            if (old.attachmentId)
                await tx
                    .update(files)
                    .set({
                        importMetadata: {
                            taskId: old.id,
                            source: scope.source,
                            previousSource: false,
                        },
                    })
                    .where(eq(files.id, old.attachmentId));
        } else
            await tx.insert(tasks).values({
                orgId: scope.orgId,
                workspaceId: scope.workspaceId,
                jobId,
                messageId,
                sourceKey: d.sourceKey,
                manifest: d.manifest,
                fileName: d.name,
                expectedSize:
                    d.size !== null &&
                    Number.isSafeInteger(d.size) &&
                    d.size <= 2147483647 &&
                    d.size >= 0
                        ? d.size
                        : null,
                expectedSha256:
                    d.sha && /^[a-f0-9]{64}$/.test(d.sha) ? d.sha : null,
                locator: {
                    ...d.locator,
                    conversationId: String(row.data.conversationId),
                    messageSourceId: row.sourceId,
                },
                metadataValid: !d.invalid,
                sourceUrl: d.url,
                state: d.invalid
                    ? "failed"
                    : d.url
                      ? "pending"
                      : "needs_source",
                error: d.invalid
                    ? "원본 파일의 크기 또는 SHA-256 정보를 확인해주세요."
                    : d.url
                      ? null
                      : "원본 서비스에서 새 파일 주소를 받거나 파일을 보충해주세요.",
            });
    }
}
