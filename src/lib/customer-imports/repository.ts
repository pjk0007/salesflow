import { requireCustomerAccess } from "@/lib/customer-access/access";
import { and, desc, eq, lt, or, inArray } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    customerImports as jobs,
    customerImportResults as results,
    customerImportAudit as audit,
    inboxChannels,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { lockWorkflowWorkspace } from "@/lib/customer-workflows/repository";
import { InboxError } from "@/lib/inbox/errors";
import {
    createImportInput,
    fingerprint,
    kinds,
    sourceUuid,
    type ImportPlanRow,
} from "./rules";
import { normalizeImport } from "./adapters";
import {
    rowState,
    rowExternalId,
    rowReferences,
    targetSnapshot,
    importObject,
    type ImportScope,
} from "./storage";
import {
    applyImportRow,
    refreshImportedConversations,
    type ImportMessageBatch,
} from "./writer";
type Job = typeof jobs.$inferSelect;
const scopeOf = (
    actor: SalesActor,
    input: { source: string; namespace: string; workspaceId: number },
) => ({ ...input, orgId: actor.orgId }) as ImportScope;
export async function importOwned(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
    lock = false,
) {
    const query = exec
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.orgId, actor.orgId)));
    const [job] = lock ? await query.for("update") : await query;
    if (!job) throw new InboxError("이전 작업을 찾을 수 없습니다.", 404);
    await requireCustomerAccess(actor, job.workspaceId, "manage", exec);
    return job;
}
/** Authorization lookups do not need to load the original content and import plan. */
export async function importWorkspaceOwned(actor: SalesActor, id: string, exec: DbExec = db) {
    const [job] = await exec.select({ workspaceId: jobs.workspaceId }).from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.orgId, actor.orgId)));
    if (!job) throw new InboxError("이전 작업을 찾을 수 없습니다.", 404);
    await requireCustomerAccess(actor, job.workspaceId, "manage", exec);
    return job.workspaceId;
}
export async function importPage(
    actor: SalesActor,
    workspaceId: number,
    before?: string,
    exec: DbExec = db,
) {
    await requireCustomerAccess(actor, workspaceId, "manage", exec);
    const base = and(
        eq(jobs.orgId, actor.orgId),
        eq(jobs.workspaceId, workspaceId),
    );
    const [cursor] = before
        ? await exec
              .select()
              .from(jobs)
              .where(and(base, eq(jobs.id, before)))
        : [];
    if (before && !cursor)
        throw new InboxError("이전 작업 목록 위치를 확인해주세요.", 404);
    const rows = await exec
        .select({
            id: jobs.id,
            source: jobs.source,
            namespace: jobs.namespace,
            state: jobs.state,
            cursor: jobs.cursor,
            version: jobs.version,
            createdAt: jobs.createdAt,
            reason: jobs.reason,
        })
        .from(jobs)
        .where(
            and(
                base,
                cursor
                    ? or(
                          lt(jobs.createdAt, cursor.createdAt),
                          and(
                              eq(jobs.createdAt, cursor.createdAt),
                              lt(jobs.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(jobs.createdAt), desc(jobs.id))
        .limit(50);
    return { rows, hasMore: rows.length === 50 };
}
export async function importDetail(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
    before?: number,
) {
    const job = await importOwned(actor, id, exec);
    const page = job.plan.slice(before ?? 0, (before ?? 0) + 100);
    const saved = await exec
        .select()
        .from(results)
        .where(
            and(
                eq(results.jobId, id),
                inArray(
                    results.position,
                    page.map((p) => p.index),
                ),
            ),
        )
        .orderBy(results.position);
    const history = await exec
        .select()
        .from(audit)
        .where(eq(audit.jobId, id))
        .orderBy(desc(audit.createdAt))
        .limit(100);
    const counts = Object.fromEntries(
        kinds.map((k) => [k, job.plan.filter((r) => r.kind === k).length]),
    );
    const { input, plan, ...safe } = job;
    return {
        ...safe,
        total: plan.length,
        counts,
        rows: page,
        results: saved,
        hasMore: (before ?? 0) + 100 < plan.length,
        audit: history,
        input: { ...input, content: undefined },
    };
}
export async function importSource(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
) {
    const job = await importOwned(actor, id, exec);
    return { input: job.input };
}
export async function previewImport(
    actor: SalesActor,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = createImportInput.parse(raw);
    await requireCustomerAccess(actor, input.workspaceId, "manage", exec);
    const normalized = normalizeImport(input),
        scope = scopeOf(actor, input),
        plan: ImportPlanRow[] = [];
    if (normalized.rows.some((r) => r.kind === "conversations")) {
        const [channel] = await exec
            .select({ id: inboxChannels.id })
            .from(inboxChannels)
            .where(
                and(
                    eq(inboxChannels.orgId, actor.orgId),
                    eq(inboxChannels.workspaceId, input.workspaceId),
                ),
            );
        if (!channel)
            normalized.errors.push(
                "과거 상담을 저장할 이 사업의 상담창을 먼저 만들어주세요.",
            );
    }
    for (const [index, row] of normalized.rows.entries()) {
        const state = await rowState(scope, row, exec),
            errors = [...row.errors],
            warnings: string[] = [];
        let operation: ImportPlanRow["operation"] = "create";
        if (state.key && !state.current)
            errors.push(
                "이전에 연결한 대상이 없거나 다른 사업에 있습니다. 원본 연결을 확인해주세요.",
            );
        if (state.key && state.current) {
            if (
                state.key.sourceFingerprint ===
                fingerprint({ data: row.data, original: row.original })
            )
                operation = "reuse";
            else if (!state.key.owned) operation = "link";
            else if (input.updateImported) {
                if (state.key.targetFingerprint !== fingerprint(state.current))
                    errors.push(
                        "이전 후 샌드비에서 수정한 자료입니다. 자동으로 덮어쓰지 않습니다.",
                    );
                operation = "update";
            } else
                errors.push(
                    "이전에 가져온 원본이 바뀌었습니다. 기존 이전 자료 갱신을 선택해 다시 검토해주세요.",
                );
        } else if (state.current) {
            operation = "link";
            warnings.push(
                "외부 ID가 같은 기존 자료에 연결합니다. 기존 필드 값은 보존합니다.",
            );
        }
        if (
            row.kind === "messages" &&
            Array.isArray(row.data.files) &&
            row.data.files.length
        )
            warnings.push(
                "첨부 이름·정보를 먼저 저장합니다. 원본 파일은 상담 저장 후 첨부파일 이전 단계에서 따로 가져오거나 보충해주세요.",
            );
        plan.push({
            ...row,
            index,
            operation: errors.length ? "error" : operation,
            errors,
            warnings,
            expected: state.expected,
            targetId: state.targetId,
            dependencies: [],
        });
    }
    const rowsById = new Map(plan.map((r) => [`${r.kind}:${r.sourceId}`, r])),
        targets = new Set<string>();
    for (const row of plan) {
        const targetKey = `${row.kind}:${row.targetId ?? rowExternalId(scope, row)}`;
        if (
            targets.has(targetKey) &&
            row.kind !== "messages" &&
            row.kind !== "conversations"
        )
            row.errors.push(
                "여러 원본 행이 같은 대상 외부 ID에 연결됩니다. 매핑을 구분해주세요.",
            );
        targets.add(targetKey);
        for (const ref of rowReferences(row)) {
            if (rowsById.has(`${ref.kind}:${ref.sourceId}`))
                row.dependencies.push(ref);
            else {
                const key = await importObject(
                        scope,
                        ref.kind,
                        ref.sourceId,
                        exec,
                    ),
                    value = key
                        ? await targetSnapshot(
                              scope,
                              ref.kind,
                              key.targetId,
                              exec,
                          )
                        : null;
                if (!key || !value)
                    row.errors.push(
                        `${ref.kind} 원본 ${ref.sourceId}의 연결 자료가 없습니다.`,
                    );
                else
                    row.dependencies.push({
                        ...ref,
                        targetId: key.targetId,
                        expected: fingerprint(value),
                    });
            }
        }
        if (row.kind === "deals") {
            const pipeline = rowsById.get(`pipelines:${row.data.pipelineId}`);
            let stages: unknown = pipeline?.data.stages;
            if (pipeline?.targetId)
                stages = (
                    await targetSnapshot(
                        scope,
                        "pipelines",
                        pipeline.targetId,
                        exec,
                    )
                )?.stages;
            if (!pipeline) {
                const key = await importObject(
                    scope,
                    "pipelines",
                    String(row.data.pipelineId),
                    exec,
                );
                stages = key
                    ? (
                          await targetSnapshot(
                              scope,
                              "pipelines",
                              key.targetId,
                              exec,
                          )
                      )?.stages
                    : [];
            }
            const stageIds = (Array.isArray(stages) ? stages : []).map(
                    (s) => (s as { id: string }).id,
                ),
                stage = String(row.data.stageId),
                mapped = sourceUuid(
                    `${input.source}:${input.namespace}:${row.data.pipelineId}`,
                    stage,
                );
            if (!stageIds.includes(stage) && !stageIds.includes(mapped))
                row.errors.push(
                    "딜 단계가 원본 파이프라인 또는 연결 대상에 없습니다.",
                );
        }
        if (row.errors.length) row.operation = "error";
    }
    const errors = [
            ...normalized.errors,
            ...plan.flatMap((r) =>
                r.errors.map((e) => `${r.kind}/${r.sourceId}: ${e}`),
            ),
        ],
        warnings = [
            ...normalized.warnings,
            ...plan.flatMap((r) =>
                r.warnings.map((w) => `${r.kind}/${r.sourceId}: ${w}`),
            ),
        ];
    return exec.transaction(async (tx) => {
        const [job] = await tx
            .insert(jobs)
            .values({
                orgId: actor.orgId,
                workspaceId: input.workspaceId,
                source: input.source,
                namespace: input.namespace,
                input,
                plan,
                errors,
                warnings,
                fingerprint: fingerprint({ input, plan, errors, warnings }),
                createdBy: actor.userId,
            })
            .returning();
        await tx.insert(audit).values({
            jobId: job.id,
            actorName: actor.name,
            action: "preview",
            detail: {
                total: plan.length,
                errors: errors.length,
                warnings: warnings.length,
                verifiedCustomerHistory: input.verifiedCustomerHistory,
            },
        });
        return importDetail(actor, job.id, tx);
    });
}
export async function changeImport(
    actor: SalesActor,
    id: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = z
        .object({
            action: z.enum(["start", "pause", "resume", "cancel"]),
            version: z.number().int().positive(),
            fingerprint: z.string().length(64).optional(),
            acknowledge: z.boolean().optional(),
        })
        .strict()
        .parse(raw);
    const hint = await importOwned(actor, id, exec);
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, hint.workspaceId, tx);
        const job = await importOwned(actor, id, tx, true);
        if (job.version !== input.version)
            throw new InboxError(
                "이전 작업 상태가 바뀌었습니다. 다시 불러와주세요.",
                409,
            );
        let state = job.state;
        if (input.action === "start") {
            if (
                state !== "ready" ||
                job.errors.length ||
                input.fingerprint !== job.fingerprint ||
                !input.acknowledge
            )
                throw new InboxError(
                    "오류 없는 미리보기와 원본/건수 확인 후 실행해주세요.",
                    409,
                );
            const scope = scopeOf(actor, job.input);
            for (const row of job.plan)
                if ((await rowState(scope, row, tx)).expected !== row.expected)
                    throw new InboxError(
                        "미리보기 이후 대상 자료가 바뀌었습니다. 미리보기를 다시 만들어주세요.",
                        409,
                    );
            for (const row of job.plan)
                for (const dependency of row.dependencies)
                    if (
                        dependency.targetId &&
                        fingerprint(
                            await targetSnapshot(
                                scope,
                                dependency.kind,
                                dependency.targetId,
                                tx,
                            ),
                        ) !== dependency.expected
                    )
                        throw new InboxError(
                            "미리보기 이후 관계 자료가 바뀌었습니다. 미리보기를 다시 만들어주세요.",
                            409,
                        );
            state = "running";
        }
        if (input.action === "pause") {
            if (state !== "running")
                throw new InboxError(
                    "실행 중인 이전 작업만 일시 중지할 수 있습니다.",
                    409,
                );
            state = "paused";
        }
        if (input.action === "resume") {
            if (!["paused", "failed"].includes(state))
                throw new InboxError(
                    "중지 또는 실패한 작업만 재개할 수 있습니다.",
                    409,
                );
            state = "running";
        }
        if (input.action === "cancel") {
            if (["completed", "cancelled"].includes(state))
                throw new InboxError("이미 종료한 이전 작업입니다.", 409);
            state = "cancelled";
        }
        await tx
            .update(jobs)
            .set({
                state,
                reason: null,
                version: job.version + 1,
                updatedAt: new Date(),
            })
            .where(eq(jobs.id, id));
        await tx.insert(audit).values({
            jobId: id,
            actorName: actor.name,
            action: input.action,
            detail: { cursor: job.cursor, total: job.plan.length },
        });
        return importDetail(actor, id, tx);
    });
}
export async function stepImport(
    actor: SalesActor,
    id: string,
    raw: unknown,
    exec: DbExec = db,
    batchSize = 25,
) {
    // 웹/API는 기본 25행이다. 대용량 이전용 관리자 실행기도 같은 검증·원자 처리를 사용한다.
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 250)
        throw new InboxError("이전 묶음은 1~250행으로 지정해주세요.");
    const input = z
            .object({ cursor: z.number().int().min(0) })
            .strict()
            .parse(raw),
        hint = await importOwned(actor, id, exec);
    try {
        return await exec.transaction(async (tx) => {
            await lockWorkflowWorkspace(actor.orgId, hint.workspaceId, tx);
            const job = await importOwned(actor, id, tx, true);
            if (job.state !== "running" || job.cursor !== input.cursor)
                return importDetail(actor, id, tx);
            const scope = scopeOf(actor, job.input);
            let cursor = job.cursor;
            const messageBatch: ImportMessageBatch = new Map();
            for (const row of job.plan.slice(cursor, cursor + batchSize)) {
                await applyImportRow(actor, scope, job, row, tx, messageBatch);
                cursor++;
            }
            // Derived chat fields are not part of the stable import fingerprint.
            // Flush in this same transaction, before advancing the durable cursor.
            await refreshImportedConversations(tx, messageBatch);
            const state = cursor === job.plan.length ? "completed" : "running";
            await tx
                .update(jobs)
                .set({
                    cursor,
                    state,
                    version: job.version + 1,
                    reason: null,
                    updatedAt: new Date(),
                })
                .where(eq(jobs.id, id));
            if (state === "completed")
                await tx.insert(audit).values({
                    jobId: id,
                    actorName: actor.name,
                    action: "completed",
                    detail: { total: cursor },
                });
            return importDetail(actor, id, tx);
        });
    } catch (error) {
        return exec.transaction(async (tx) => {
            await lockWorkflowWorkspace(actor.orgId, hint.workspaceId, tx);
            const current = await importOwned(actor, id, tx, true);
            if (
                current.state === "running" &&
                current.cursor === input.cursor
            ) {
                const reason =
                    error instanceof InboxError
                        ? error.message
                        : "자료 저장에 실패했습니다. 이번 묶음은 적용하지 않았습니다. 원인을 확인한 뒤 재개해주세요.";
                await tx
                    .update(jobs)
                    .set({
                        state: "failed",
                        reason,
                        version: current.version + 1,
                        updatedAt: new Date(),
                    })
                    .where(eq(jobs.id, id));
                await tx.insert(audit).values({
                    jobId: id,
                    actorName: actor.name,
                    action: "failed",
                    detail: { cursor: current.cursor, reason },
                });
            }
            return importDetail(actor, id, tx);
        });
    }
}
export type ImportJob = Job;
