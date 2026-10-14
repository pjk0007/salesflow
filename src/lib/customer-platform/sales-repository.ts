import { enqueuePlatformEvent } from "./outbox";
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import {
    db,
    crmPipelines,
    crmDeals,
    crmDealHistory,
    crmTasks,
    crmContacts,
    crmCompanies,
    users,
    organizationMembers,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload } from "@/types";
import { InboxError } from "@/lib/inbox/errors";
import { requirePlatformWorkspace } from "./repository";
import { appendActivity } from "./activities";
import {
    pipelineInput,
    pipelinePatch,
    dealInput,
    dealPatch,
    taskInput,
    taskPatch,
    salesListInput,
} from "./sales-rules";
export type SalesResource = "pipelines" | "deals" | "tasks";
export type SalesActor = Pick<JWTPayload, "orgId" | "userId" | "name" | "role">;
const tableFor = (resource: SalesResource) =>
    resource === "pipelines"
        ? crmPipelines
        : resource === "deals"
          ? crmDeals
          : crmTasks;
function amount(value: string) {
    const [whole, fraction = ""] = value.split(".");
    return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}
export async function listSales(
    actor: SalesActor,
    workspaceId: number,
    resource: SalesResource,
    raw: unknown = {},
    exec: DbExec = db,
) {
    await requirePlatformWorkspace(actor.orgId, workspaceId, exec);
    const input = salesListInput.parse(raw),
        table = tableFor(resource),
        pattern = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
    return exec
        .select()
        .from(table)
        .where(
            and(
                eq(table.orgId, actor.orgId),
                eq(table.workspaceId, workspaceId),
                input.before ? lt(table.id, input.before) : undefined,
                input.q
                    ? ilike(
                          resource === "pipelines"
                              ? crmPipelines.name
                              : resource === "deals"
                                ? crmDeals.title
                                : crmTasks.title,
                          pattern,
                      )
                    : undefined,
                resource === "deals"
                    ? input.archived === "true"
                        ? sql`${crmDeals.archivedAt} IS NOT NULL`
                        : isNull(crmDeals.archivedAt)
                    : undefined,
                resource === "deals" && input.pipelineId
                    ? eq(crmDeals.pipelineId, input.pipelineId)
                    : undefined,
                resource === "tasks" && input.status
                    ? eq(crmTasks.status, input.status)
                    : undefined,
            ),
        )
        .orderBy(desc(table.id))
        .limit(100);
}
export async function ownedSales(
    actor: SalesActor,
    workspaceId: number,
    resource: SalesResource,
    id: string,
    exec: DbExec = db,
    lock = false,
) {
    const table = tableFor(resource),
        query = exec
            .select()
            .from(table)
            .where(
                and(
                    eq(table.id, id),
                    eq(table.orgId, actor.orgId),
                    eq(table.workspaceId, workspaceId),
                ),
            );
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new InboxError("영업 항목을 찾을 수 없습니다.", 404);
    return row;
}
async function relations(
    actor: SalesActor,
    workspaceId: number,
    input: {
        contactId?: string | null;
        companyId?: string | null;
        ownerId?: string | null;
        dealId?: string | null;
    },
    exec: DbExec,
) {
    for (const [id, table, label] of [
        [input.contactId, crmContacts, "고객"],
        [input.companyId, crmCompanies, "회사"],
        [input.dealId, crmDeals, "딜"],
    ] as const) {
        if (!id) continue;
        const [row] = await exec
            .select({ id: table.id })
            .from(table)
            .where(
                and(
                    eq(table.id, id),
                    eq(table.orgId, actor.orgId),
                    eq(table.workspaceId, workspaceId),
                ),
            );
        if (!row)
            throw new InboxError(`같은 사업의 ${label}만 연결할 수 있습니다.`);
    }
    if (input.ownerId) {
        const [member] = await exec
            .select({ id: users.id })
            .from(users)
            .innerJoin(
                organizationMembers,
                eq(organizationMembers.userId, users.id),
            )
            .where(
                and(
                    eq(users.id, input.ownerId),
                    eq(users.isActive, 1),
                    eq(organizationMembers.organizationId, actor.orgId),
                ),
            );
        if (!member)
            throw new InboxError("이 조직의 활성 담당자를 선택해주세요.");
    }
}
async function dealPipeline(
    actor: SalesActor,
    workspaceId: number,
    pipelineId: string,
    stageId: string,
    exec: DbExec,
) {
    const [pipeline] = await exec
        .select()
        .from(crmPipelines)
        .where(
            and(
                eq(crmPipelines.id, pipelineId),
                eq(crmPipelines.orgId, actor.orgId),
                eq(crmPipelines.workspaceId, workspaceId),
            ),
        )
        .for("update");
    const stage = pipeline?.stages.find((s) => s.id === stageId);
    if (!pipeline || !stage)
        throw new InboxError(
            "같은 사업의 파이프라인과 유효한 단계를 선택해주세요.",
        );
    return { pipeline, stage };
}
async function previousCreate(
    actor: SalesActor,
    resource: SalesResource,
    input: Record<string, unknown> & {
        workspaceId: number;
        externalId: string;
    },
    exec: DbExec,
) {
    const table = tableFor(resource),
        [row] = await exec
            .select()
            .from(table)
            .where(
                and(
                    eq(table.orgId, actor.orgId),
                    eq(table.workspaceId, input.workspaceId),
                    eq(table.externalId, input.externalId),
                ),
            );
    if (!row)
        throw new InboxError(
            "생성 결과를 확인하지 못했습니다. 다시 시도해주세요.",
            409,
        );
    const saved = row as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        const same =
            key === "amount"
                ? amount(String(saved[key])) === amount(String(value))
                : key === "dueAt" && value
                  ? new Date(String(saved[key])).getTime() ===
                    Date.parse(String(value))
                  : isDeepStrictEqual(saved[key], value);
        if (!same)
            throw new InboxError(
                "같은 외부 번호의 항목이 다른 내용으로 존재합니다. 기존 항목을 수정해주세요.",
                409,
            );
    }
    return row;
}
export async function createSales(
    actor: SalesActor,
    resource: SalesResource,
    raw: unknown,
    exec: DbExec = db,
) {
    const input =
        resource === "pipelines"
            ? pipelineInput.parse(raw)
            : resource === "deals"
              ? dealInput.parse(raw)
              : taskInput.parse(raw);
    await requirePlatformWorkspace(actor.orgId, input.workspaceId, exec);
    return exec.transaction(async (tx) => {
        if (resource === "pipelines") {
            const value = pipelineInput.parse(input),
                [created] = await tx
                    .insert(crmPipelines)
                    .values({ ...value, orgId: actor.orgId })
                    .onConflictDoNothing({
                        target: [
                            crmPipelines.workspaceId,
                            crmPipelines.externalId,
                        ],
                    })
                    .returning();
            if (created)
                await enqueuePlatformEvent(tx, {
                    orgId: actor.orgId,
                    workspaceId: value.workspaceId,
                    key: `pipeline:${created.id}:v${created.version}`,
                    type: "pipeline.created",
                    data: { pipeline: created },
                });
            return created ?? previousCreate(actor, resource, value, tx);
        }
        if (resource === "deals") {
            const value = dealInput.parse(input);
            await relations(actor, value.workspaceId, value, tx);
            const { stage } = await dealPipeline(
                actor,
                value.workspaceId,
                value.pipelineId,
                value.stageId,
                tx,
            );
            const [created] = await tx
                .insert(crmDeals)
                .values({
                    ...value,
                    amount: amount(value.amount),
                    orgId: actor.orgId,
                })
                .onConflictDoNothing({
                    target: [crmDeals.workspaceId, crmDeals.externalId],
                })
                .returning();
            if (!created) return previousCreate(actor, resource, value, tx);
            await enqueuePlatformEvent(tx, {
                orgId: actor.orgId,
                workspaceId: value.workspaceId,
                key: `deal:${created.id}:v${created.version}`,
                type: "deal.created",
                data: { deal: created },
            });
            await tx.insert(crmDealHistory).values({
                dealId: created.id,
                actorId: actor.userId,
                actorName: actor.name,
                change: { action: "created", stage, after: created },
            });
            await appendActivity(tx, {
                orgId: actor.orgId,
                workspaceId: value.workspaceId,
                contactId: created.contactId,
                companyId: created.companyId,
                source: "deal",
                entityId: created.id,
                eventKey: `deal:${created.id}:v${created.version}`,
                action: "created",
                summary: created.title,
                actorName: actor.name,
                metadata: { stage, version: created.version },
                occurredAt: created.createdAt,
            });
            return created;
        }
        const value = taskInput.parse(input);
        await relations(actor, value.workspaceId, value, tx);
        const [created] = await tx
            .insert(crmTasks)
            .values({
                ...value,
                orgId: actor.orgId,
                dueAt: value.dueAt ? new Date(value.dueAt) : null,
                completedAt: value.status === "done" ? new Date() : null,
            })
            .onConflictDoNothing({
                target: [crmTasks.workspaceId, crmTasks.externalId],
            })
            .returning();
        if (created)
            await enqueuePlatformEvent(tx, {
                orgId: actor.orgId,
                workspaceId: value.workspaceId,
                key: `task:${created.id}:v${created.version}`,
                type: "task.created",
                data: { task: created },
            });
        if (created)
            await appendActivity(tx, {
                orgId: actor.orgId,
                workspaceId: value.workspaceId,
                contactId: created.contactId,
                companyId: created.companyId,
                source: "task",
                entityId: created.id,
                eventKey: `task:${created.id}:v${created.version}`,
                action: "created",
                summary: created.title,
                actorName: actor.name,
                metadata: {
                    status: created.status,
                    dealId: created.dealId,
                    version: created.version,
                },
                occurredAt: created.createdAt,
            });
        return created ?? previousCreate(actor, resource, value, tx);
    });
}
export async function patchSales(
    actor: SalesActor,
    workspaceId: number,
    resource: SalesResource,
    id: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input =
        resource === "pipelines"
            ? pipelinePatch.parse(raw)
            : resource === "deals"
              ? dealPatch.parse(raw)
              : taskPatch.parse(raw);
    if (Object.keys(input).length < 2)
        throw new InboxError("변경할 내용을 입력해주세요.");
    return exec.transaction(async (tx) => {
        const current = await ownedSales(
            actor,
            workspaceId,
            resource,
            id,
            tx,
            true,
        );
        if (current.version !== input.version)
            throw new InboxError(
                "다른 팀원이 수정했습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.",
                409,
            );
        const now = new Date();
        if (resource === "pipelines") {
            const { version, ...change } = pipelinePatch.parse(input);
            if (change.stages) {
                const valid = change.stages.map((s) => s.id),
                    [used] = await tx
                        .select({ id: crmDeals.id })
                        .from(crmDeals)
                        .where(
                            and(
                                eq(crmDeals.pipelineId, id),
                                sql`${crmDeals.stageId} NOT IN (${sql.join(
                                    valid.map((value) => sql`${value}::uuid`),
                                    sql`,`,
                                )})`,
                            ),
                        )
                        .limit(1);
                if (used)
                    throw new InboxError(
                        "딜에서 사용 중인 단계는 삭제할 수 없습니다. 딜을 먼저 다른 단계로 옮겨주세요.",
                        409,
                    );
            }
            const [saved] = await tx
                .update(crmPipelines)
                .set({ ...change, version: version + 1, updatedAt: now })
                .where(eq(crmPipelines.id, id))
                .returning();
            await enqueuePlatformEvent(tx, {
                orgId: actor.orgId,
                workspaceId,
                key: `pipeline:${saved.id}:v${saved.version}`,
                type: "pipeline.updated",
                data: { pipeline: saved },
            });
            return saved;
        }
        if (resource === "deals") {
            const { version, archived, ...change } = dealPatch.parse(input),
                [old] = await tx
                    .select()
                    .from(crmDeals)
                    .where(eq(crmDeals.id, id));
            const next = { ...old, ...change };
            await relations(actor, workspaceId, next, tx);
            const { stage } = await dealPipeline(
                actor,
                workspaceId,
                next.pipelineId,
                next.stageId,
                tx,
            );
            const [saved] = await tx
                .update(crmDeals)
                .set({
                    ...change,
                    amount:
                        change.amount === undefined
                            ? undefined
                            : amount(change.amount),
                    archivedAt:
                        archived === undefined
                            ? undefined
                            : archived
                              ? (old.archivedAt ?? now)
                              : null,
                    version: version + 1,
                    updatedAt: now,
                })
                .where(eq(crmDeals.id, id))
                .returning();
            await enqueuePlatformEvent(tx, {
                orgId: actor.orgId,
                workspaceId,
                key: `deal:${saved.id}:v${saved.version}`,
                type: "deal.updated",
                data: { deal: saved, before: old },
            });
            await tx.insert(crmDealHistory).values({
                dealId: id,
                actorId: actor.userId,
                actorName: actor.name,
                change: {
                    action:
                        archived === true
                            ? "archived"
                            : archived === false
                              ? "restored"
                              : "updated",
                    before: old,
                    after: saved,
                    stage,
                },
            });
            await appendActivity(tx, {
                orgId: actor.orgId,
                workspaceId,
                contactId: saved.contactId,
                companyId: saved.companyId,
                source: "deal",
                entityId: id,
                eventKey: `deal:${id}:v${saved.version}`,
                action:
                    archived === true
                        ? "archived"
                        : archived === false
                          ? "restored"
                          : "updated",
                summary: saved.title,
                actorName: actor.name,
                metadata: { stage, version: saved.version },
                occurredAt: now,
            });
            if (old.contactId && old.contactId !== saved.contactId)
                await appendActivity(tx, {
                    orgId: actor.orgId,
                    workspaceId,
                    contactId: old.contactId,
                    companyId: old.companyId,
                    source: "deal",
                    entityId: id,
                    eventKey: `deal:${id}:v${saved.version}:old`,
                    action: "unlinked",
                    summary: old.title,
                    actorName: actor.name,
                    metadata: { version: saved.version },
                    occurredAt: now,
                });
            return saved;
        }
        const { version, ...change } = taskPatch.parse(input),
            [old] = await tx.select().from(crmTasks).where(eq(crmTasks.id, id));
        await relations(actor, workspaceId, { ...old, ...change }, tx);
        const [saved] = await tx
            .update(crmTasks)
            .set({
                ...change,
                dueAt:
                    change.dueAt === undefined
                        ? undefined
                        : change.dueAt
                          ? new Date(change.dueAt)
                          : null,
                completedAt:
                    change.status === undefined
                        ? undefined
                        : change.status === "done"
                          ? (old.completedAt ?? now)
                          : null,
                version: version + 1,
                updatedAt: now,
            })
            .where(eq(crmTasks.id, id))
            .returning();
        await enqueuePlatformEvent(tx, {
            orgId: actor.orgId,
            workspaceId,
            key: `task:${saved.id}:v${saved.version}`,
            type: "task.updated",
            data: { task: saved, before: old },
        });
        await appendActivity(tx, {
            orgId: actor.orgId,
            workspaceId,
            contactId: saved.contactId,
            companyId: saved.companyId,
            source: "task",
            entityId: id,
            eventKey: `task:${id}:v${saved.version}`,
            action: old.status !== saved.status ? saved.status : "updated",
            summary: saved.title,
            actorName: actor.name,
            metadata: {
                status: saved.status,
                dealId: saved.dealId,
                version: saved.version,
            },
            occurredAt: now,
        });
        if (old.contactId && old.contactId !== saved.contactId)
            await appendActivity(tx, {
                orgId: actor.orgId,
                workspaceId,
                contactId: old.contactId,
                companyId: old.companyId,
                source: "task",
                entityId: id,
                eventKey: `task:${id}:v${saved.version}:old`,
                action: "unlinked",
                summary: old.title,
                actorName: actor.name,
                metadata: { version: saved.version },
                occurredAt: now,
            });
        return saved;
    });
}
export async function salesDetail(
    actor: SalesActor,
    workspaceId: number,
    resource: SalesResource,
    id: string,
    before?: string,
    exec: DbExec = db,
) {
    const item = await ownedSales(actor, workspaceId, resource, id, exec);
    if (resource !== "deals") return { item, history: [] };
    const [cursor] = before
        ? await exec
              .select()
              .from(crmDealHistory)
              .where(
                  and(
                      eq(crmDealHistory.dealId, id),
                      eq(crmDealHistory.id, before),
                  ),
              )
        : [];
    if (before && !cursor)
        throw new InboxError("이력 페이지를 찾을 수 없습니다.", 400);
    const history = await exec
        .select()
        .from(crmDealHistory)
        .where(
            and(
                eq(crmDealHistory.dealId, id),
                cursor
                    ? or(
                          lt(crmDealHistory.createdAt, cursor.createdAt),
                          and(
                              eq(crmDealHistory.createdAt, cursor.createdAt),
                              lt(crmDealHistory.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(crmDealHistory.createdAt), desc(crmDealHistory.id))
        .limit(100);
    return { item, history };
}
