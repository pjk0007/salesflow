import {
    customerAccessPredicate,
    requireCustomerAccess,
} from "@/lib/customer-access/access";
import {
    and,
    desc,
    eq,
    getTableColumns,
    inArray,
    lt,
    or,
    sql,
} from "drizzle-orm";
import {
    db,
    workspaces,
    customerWorkflows as workflows,
    customerWorkflowRevisions as revisions,
    customerWorkflowPreviews as previews,
    customerWorkflowRuns as runs,
    customerWorkflowSteps as steps,
    customerWorkflowAudit as audit,
    platformEvents,
    crmContacts,
    inboxConversations,
    inboxChannels,
    users,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { newerFirstAfter } from "@/lib/customer-platform/list-cursor";
import { InboxError } from "@/lib/inbox/errors";
import {
    workflowInput,
    workflowWorkerEnabled,
    workflowEventTypes,
    stepNames,
    matchesGroup,
    matchesTriggerEvent,
} from "./rules";
import { workflowFingerprint } from "./rules";
import { workflowContext } from "./context";
import { previewWorkflowTeam, previewWorkflowPerson } from "./routing";
import {
    validateWorkflowReferences,
    stepTargetProblem,
    renderWorkflowText,
} from "./actions";
export const activeRunStates = ["queued", "running", "waiting", "retry"];
export async function workflowOwned(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
    lock = false,
) {
    const query = exec
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, id), eq(workflows.orgId, actor.orgId)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new InboxError("자동화를 찾을 수 없습니다.", 404);
    await requireCustomerAccess(actor, row.workspaceId, "read", exec);
    return row;
}
export async function workflowRevision(
    workflowId: string,
    id: string,
    exec: DbExec = db,
) {
    const [row] = await exec
        .select()
        .from(revisions)
        .where(and(eq(revisions.id, id), eq(revisions.workflowId, workflowId)));
    if (!row) throw new InboxError("자동화 버전을 찾을 수 없습니다.", 404);
    return row;
}
export async function lockWorkflowWorkspace(
    orgId: string,
    workspaceId: number,
    exec: DbExec,
) {
    const [w] = await exec
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, orgId)))
        .for("update");
    if (!w) throw new InboxError("사업을 찾을 수 없습니다.", 404);
}
/**
 * 게시한 직원이 지금도 이 사업의 운영 관리 권한(활성 계정·멤버십 포함)을 갖는지(UX-101).
 * 실행은 게시자 권한으로 처리되므로, 권한이 없으면 활성으로 보여도 모든 실행이 실패한다.
 * 게시 버전이 없으면(초안) true.
 */
export const publisherCanManage = (orgId: string) =>
    sql<boolean>`(${workflows.activeRevisionId} IS NULL OR EXISTS (SELECT 1 FROM ${revisions} WHERE ${revisions.id} = ${workflows.activeRevisionId} AND ${customerAccessPredicate(orgId, revisions.publishedBy, sql`${workflows.workspaceId}`, "manage")}))`;
export async function workflowList(
    actor: SalesActor,
    workspaceId: number,
    before?: string,
    exec: DbExec = db,
) {
    await requireCustomerAccess(actor, workspaceId, "read", exec);
    // 최근 변경한 자동화 먼저(UX-087). 자동화 표에는 생성 시각이 없어 updatedAt을 쓴다.
    const [cursor] = before
        ? await exec
              .select({ at: workflows.updatedAt, id: workflows.id })
              .from(workflows)
              .where(
                  and(
                      eq(workflows.id, before),
                      eq(workflows.orgId, actor.orgId),
                      eq(workflows.workspaceId, workspaceId),
                  ),
              )
        : [];
    if (before && !cursor)
        throw new InboxError("목록 위치를 확인해주세요. 새로고침 후 다시 시도해주세요.", 404);
    const rows = await exec
        .select({
            ...getTableColumns(workflows),
            publisherCanManage: publisherCanManage(actor.orgId),
        })
        .from(workflows)
        .where(
            and(
                eq(workflows.orgId, actor.orgId),
                eq(workflows.workspaceId, workspaceId),
                newerFirstAfter(workflows.updatedAt, workflows.id, cursor),
            ),
        )
        .orderBy(desc(workflows.updatedAt), desc(workflows.id))
        .limit(50);
    return {
        rows,
        hasMore: rows.length === 50,
        workerEnabled: workflowWorkerEnabled(),
        eventTypes: workflowEventTypes,
        stepNames,
    };
}
export async function workflowDetail(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
) {
    const workflow = await workflowOwned(actor, id, exec),
        versions = await exec
            .select()
            .from(revisions)
            .where(eq(revisions.workflowId, id))
            .orderBy(desc(revisions.version))
            .limit(50),
        history = await exec
            .select()
            .from(audit)
            .where(eq(audit.workflowId, id))
            .orderBy(desc(audit.createdAt), desc(audit.id))
            .limit(100);
    if (
        workflow.activeRevisionId &&
        !versions.some((r) => r.id === workflow.activeRevisionId)
    )
        versions.push(
            await workflowRevision(id, workflow.activeRevisionId, exec),
        );
    const publishedBy = versions.find(
            (r) => r.id === workflow.activeRevisionId,
        )?.publishedBy,
        [publisher] = workflow.activeRevisionId
            ? await exec
                  .select({
                      name: sql<
                          string | null
                      >`(SELECT ${users.name} FROM ${users} WHERE ${users.id} = ${publishedBy ?? null}::uuid)`,
                      canManage: publisherCanManage(actor.orgId),
                  })
                  .from(workflows)
                  .where(eq(workflows.id, id))
            : [],
        // 중단 확인창에 취소될 대기 실행 수, 현재 적용 영역에 최근 실패 사유를 보여 준다(UX-099·101).
        [active] = await exec
            .select({ count: sql<number>`count(*)::int` })
            .from(runs)
            .where(
                and(eq(runs.workflowId, id), inArray(runs.state, activeRunStates)),
            ),
        [lastFailure] = await exec
            .select({ reason: runs.reason, updatedAt: runs.updatedAt })
            .from(runs)
            .where(and(eq(runs.workflowId, id), eq(runs.state, "failed")))
            .orderBy(desc(runs.updatedAt), desc(runs.id))
            .limit(1);
    return {
        workflow,
        revisions: versions,
        history,
        publisher: publisher ?? null,
        activeRuns: active?.count ?? 0,
        lastFailure: lastFailure ?? null,
    };
}
export async function saveWorkflow(
    actor: SalesActor,
    id: string | undefined,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = workflowInput.parse(raw);
    await requireCustomerAccess(actor, input.workspaceId, "manage", exec);
    await validateWorkflowReferences(
        actor.orgId,
        input.workspaceId,
        input.definition.steps,
        exec,
    );
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, input.workspaceId, tx);
        let workflow;
        if (id) {
            workflow = await workflowOwned(actor, id, tx, true);
            if (workflow.workspaceId !== input.workspaceId)
                throw new InboxError("자동화 사업을 변경할 수 없습니다.");
            if (workflow.version !== input.version)
                throw new InboxError(
                    "자동화가 변경되었습니다. 작성한 내용은 보존하고 최신 버전을 불러와주세요.",
                    409,
                );
        } else if (input.version !== 0)
            throw new InboxError("새 자동화 버전을 확인해주세요.");
        const version = (workflow?.version ?? 0) + 1;
        const [saved] = workflow
            ? await tx
                  .update(workflows)
                  .set({
                      name: input.name,
                      description: input.description,
                      version,
                      updatedAt: new Date(),
                  })
                  .where(eq(workflows.id, id!))
                  .returning()
            : await tx
                  .insert(workflows)
                  .values({
                      orgId: actor.orgId,
                      workspaceId: input.workspaceId,
                      name: input.name,
                      description: input.description,
                      createdBy: actor.userId,
                  })
                  .returning();
        const [revision] = await tx
            .insert(revisions)
            .values({
                workflowId: saved.id,
                version,
                name: input.name,
                description: input.description,
                definition: input.definition,
                fingerprint: workflowFingerprint(input.definition),
            })
            .returning();
        await tx.insert(audit).values({
            workflowId: saved.id,
            actorName: actor.name,
            action: "draft.saved",
            detail: {
                revisionId: revision.id,
                version,
                name: input.name,
                description: input.description,
            },
        });
        return { workflow: saved, revision };
    });
}
export async function workflowEventPage(
    actor: SalesActor,
    workspaceId: number,
    before?: string,
    exec: DbExec = db,
) {
    await requireCustomerAccess(actor, workspaceId, "read", exec);
    const base = and(
        eq(platformEvents.orgId, actor.orgId),
        eq(platformEvents.workspaceId, workspaceId),
        inArray(platformEvents.type, workflowEventTypes),
    );
    let cursor;
    if (before) {
        [cursor] = await exec
            .select({ sequence: platformEvents.sequence })
            .from(platformEvents)
            .where(and(base, eq(platformEvents.id, before)));
        if (!cursor)
            throw new InboxError("이벤트 위치를 찾을 수 없습니다.", 404);
    }
    const rows = await exec
        .select({
            id: platformEvents.id,
            type: platformEvents.type,
            payload: platformEvents.payload,
            createdAt: platformEvents.createdAt,
        })
        .from(platformEvents)
        .where(
            and(
                base,
                cursor
                    ? lt(platformEvents.sequence, cursor.sequence)
                    : undefined,
            ),
        )
        .orderBy(desc(platformEvents.sequence))
        .limit(50);
    const references = rows.map((e) => {
        const d = e.payload.data as Record<string, unknown>;
        const object = (v: unknown) =>
            v && typeof v === "object" ? (v as Record<string, unknown>) : {};
        return {
            contactId: (d.contactId ??
                object(d.contact).id ??
                object(d.event).contactId ??
                object(d.deal).contactId ??
                object(d.task).contactId) as string | undefined,
            conversationId: d.conversationId as string | undefined,
        };
    });
    const validIds = (ids: (string | undefined)[]) => [
        ...new Set(
            ids.filter(
                (v): v is string =>
                    typeof v === "string" && /^[a-f0-9-]{36}$/i.test(v),
            ),
        ),
    ];
    const contactIds = validIds(references.map((r) => r.contactId)),
        conversationIds = validIds(references.map((r) => r.conversationId));
    const contacts = contactIds.length
        ? await exec
              .select({ id: crmContacts.id, name: crmContacts.name })
              .from(crmContacts)
              .where(
                  and(
                      eq(crmContacts.orgId, actor.orgId),
                      eq(crmContacts.workspaceId, workspaceId),
                      inArray(crmContacts.id, contactIds),
                  ),
              )
        : [];
    const conversations = conversationIds.length
        ? await exec
              .select({
                  id: inboxConversations.id,
                  name: inboxConversations.name,
              })
              .from(inboxConversations)
              .innerJoin(
                  inboxChannels,
                  eq(inboxChannels.id, inboxConversations.channelId),
              )
              .where(
                  and(
                      eq(inboxConversations.orgId, actor.orgId),
                      eq(inboxChannels.workspaceId, workspaceId),
                      inArray(inboxConversations.id, conversationIds),
                  ),
              )
        : [];
    return {
        rows: rows.map((r, i) => ({
            ...r,
            customerName:
                contacts.find((c) => c.id === references[i].contactId)?.name ??
                conversations.find((c) => c.id === references[i].conversationId)
                    ?.name ??
                null,
        })),
        hasMore: rows.length === 50,
    };
}
export async function simulateWorkflow(
    actor: SalesActor,
    id: string,
    revisionId: string,
    eventId: string,
    exec: DbExec = db,
) {
    const workflow = await workflowOwned(actor, id, exec),
        revision = await workflowRevision(id, revisionId, exec),
        [event] = await exec
            .select()
            .from(platformEvents)
            .where(
                and(
                    eq(platformEvents.id, eventId),
                    eq(platformEvents.orgId, actor.orgId),
                    eq(platformEvents.workspaceId, workflow.workspaceId),
                ),
            );
    await requireCustomerAccess(actor, workflow.workspaceId, "manage", exec);
    if (!event) throw new InboxError("같은 사업의 이벤트를 선택해주세요.", 404);
    await validateWorkflowReferences(
        actor.orgId,
        workflow.workspaceId,
        revision.definition.steps,
        exec,
    );
    const context = await workflowContext(
            actor.orgId,
            workflow.workspaceId,
            event.payload as unknown as Record<string, unknown>,
            exec,
        ),
        def = revision.definition,
        matched =
            !context.internal &&
            !context.archived &&
            matchesTriggerEvent(def.trigger, event.payload) &&
            matchesGroup(def.trigger.when, context);
    const report: {
        matched: boolean;
        context: Record<string, unknown>;
        steps: {
            id: string;
            label: string;
            kind: string;
            status: "planned" | "skipped" | "invalid";
            detail: string;
        }[];
        errors: string[];
        hasCustomerReply: boolean;
    } = {
        matched,
        context: JSON.parse(JSON.stringify(context)),
        steps: [],
        errors: [],
        hasCustomerReply: def.steps.some((s) => s.kind === "reply"),
    };
    for (const step of def.steps) {
        let status: "planned" | "skipped" | "invalid" = "planned",
            detail = stepNames[step.kind];
        if (!matched || !matchesGroup(step.when, context)) {
            status = "skipped";
            detail = "진입 또는 단계 조건에 맞지 않습니다.";
        } else {
            const problem = stepTargetProblem(step, context);
            if (problem) {
                status = "skipped";
                detail = problem;
            } else
                try {
                    if (step.kind === "team")
                        detail = await previewWorkflowTeam(
                            actor.orgId,
                            workflow.workspaceId,
                            step.teamId,
                            context,
                            exec,
                        );
                    if (step.kind === "reply")
                        detail = renderWorkflowText(step.body, context);
                    if (step.kind === "task")
                        detail = renderWorkflowText(step.title, context, 200);
                    if (step.kind === "wait")
                        detail = `${step.minutes}분 대기 후 최신 정보로 다음 조건을 확인합니다.`;
                    if (step.kind === "contact_stage" && context.contact)
                        context.contact.lifecycleStage = step.stage;
                    if (step.kind === "tag" && context.conversation)
                        context.conversation.tags = step.remove
                            ? context.conversation.tags.filter(
                                  (t) => t !== step.tag,
                              )
                            : [
                                  ...new Set([
                                      ...context.conversation.tags,
                                      step.tag,
                                  ]),
                              ];
                    if (step.kind === "assign" && context.conversation)
                        await previewWorkflowPerson(
                            actor.orgId,
                            workflow.workspaceId,
                            step.assigneeId,
                            context,
                            exec,
                        );
                    if (step.kind === "status" && context.conversation)
                        context.conversation.status = step.status;
                    if (step.kind === "handoff" && context.conversation)
                        context.conversation.aiState = "human";
                } catch (e) {
                    status = "invalid";
                    detail = (e as Error).message;
                    report.errors.push(detail);
                }
        }
        report.steps.push({
            id: step.id,
            label: step.label,
            kind: step.kind,
            status,
            detail,
        });
    }
    const [preview] = await exec
        .insert(previews)
        .values({
            workflowId: id,
            revisionId,
            eventId,
            fingerprint: revision.fingerprint,
            report,
            passed: !report.errors.length,
            createdBy: actor.userId,
        })
        .returning();
    return preview;
}
export async function publishWorkflow(
    actor: SalesActor,
    id: string,
    input: {
        version: number;
        revisionId: string;
        previewId: string;
        allowCustomerReplies: boolean;
    },
    exec: DbExec = db,
) {
    const hint = await workflowOwned(actor, id, exec);
    await requireCustomerAccess(actor, hint.workspaceId, "manage", exec);
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, hint.workspaceId, tx);
        const workflow = await workflowOwned(actor, id, tx, true);
        if (workflow.version !== input.version)
            throw new InboxError(
                "자동화가 변경되었습니다. 최신 버전을 검토해주세요.",
                409,
            );
        const revision = await workflowRevision(id, input.revisionId, tx),
            [preview] = await tx
                .select()
                .from(previews)
                .where(
                    and(
                        eq(previews.id, input.previewId),
                        eq(previews.workflowId, id),
                        eq(previews.revisionId, revision.id),
                        eq(previews.passed, true),
                        eq(previews.fingerprint, revision.fingerprint),
                    ),
                );
        if (!preview)
            throw new InboxError(
                "저장한 동일 버전의 모의 실행 결과를 먼저 검토해주세요.",
            );
        if (revision.publishedAt)
            throw new InboxError(
                "게시한 버전은 보존합니다. 새 버전으로 저장한 뒤 적용해주세요.",
                409,
            );
        if (
            revision.definition.steps.some((s) => s.kind === "reply") &&
            !input.allowCustomerReplies
        )
            throw new InboxError(
                "고객에게 자동 안내를 보내는 문구와 조건을 확인해주세요.",
            );
        await validateWorkflowReferences(
            actor.orgId,
            workflow.workspaceId,
            revision.definition.steps,
            tx,
        );
        const count = await tx
            .select({ id: workflows.id })
            .from(workflows)
            .where(
                and(
                    eq(workflows.workspaceId, workflow.workspaceId),
                    eq(workflows.enabled, true),
                ),
            );
        if (!workflow.enabled && count.length >= 100)
            throw new InboxError(
                "사업별 활성 자동화는 100개까지 사용할 수 있습니다.",
            );
        await tx
            .update(revisions)
            .set({ publishedBy: actor.userId, publishedAt: new Date() })
            .where(eq(revisions.id, revision.id));
        await tx
            .update(workflows)
            .set({
                activeRevisionId: revision.id,
                enabled: true,
                version: workflow.version + 1,
                generation: workflow.generation + 1,
                updatedAt: new Date(),
            })
            .where(eq(workflows.id, id));
        await tx
            .update(runs)
            .set({
                state: "cancelled",
                reason: "새 버전 게시로 이전 실행을 중단했습니다.",
                leaseId: null,
                leaseUntil: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(runs.workflowId, id),
                    inArray(runs.state, activeRunStates),
                ),
            );
        await tx.insert(audit).values({
            workflowId: id,
            actorName: actor.name,
            action: "published",
            detail: {
                revisionId: revision.id,
                previewId: preview.id,
                allowCustomerReplies: input.allowCustomerReplies,
            },
        });
        return { published: true };
    });
}
export async function disableWorkflow(
    actor: SalesActor,
    id: string,
    version: number,
    exec: DbExec = db,
) {
    const hint = await workflowOwned(actor, id, exec);
    await requireCustomerAccess(actor, hint.workspaceId, "manage", exec);
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, hint.workspaceId, tx);
        const workflow = await workflowOwned(actor, id, tx, true);
        if (workflow.version !== version)
            throw new InboxError(
                "자동화가 변경되었습니다. 최신 설정을 확인해주세요.",
                409,
            );
        await tx
            .update(workflows)
            .set({
                enabled: false,
                generation: workflow.generation + 1,
                version: workflow.version + 1,
                updatedAt: new Date(),
            })
            .where(eq(workflows.id, id));
        await tx
            .update(runs)
            .set({
                state: "cancelled",
                reason: "자동화를 중단했습니다.",
                leaseId: null,
                leaseUntil: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(runs.workflowId, id),
                    inArray(runs.state, activeRunStates),
                ),
            );
        await tx.insert(audit).values({
            workflowId: id,
            actorName: actor.name,
            action: "disabled",
            detail: { generation: workflow.generation + 1 },
        });
        return { disabled: true };
    });
}
/**
 * 중단한 자동화를 같은 게시 버전으로 다시 켠다(UX-099). 새 버전 저장·모의 실행·게시를 반복하지 않는다.
 * 게시 때와 같은 조건을 다시 확인한다: 그 버전의 통과한 모의 실행(같은 지문), 현재 참조 유효성, 활성 100개 한도.
 * 중단 때 취소한 실행은 되살리지 않는다(새 이벤트부터 처리).
 */
export async function enableWorkflow(
    actor: SalesActor,
    id: string,
    version: number,
    exec: DbExec = db,
) {
    const hint = await workflowOwned(actor, id, exec);
    await requireCustomerAccess(actor, hint.workspaceId, "manage", exec);
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, hint.workspaceId, tx);
        const workflow = await workflowOwned(actor, id, tx, true);
        if (workflow.version !== version)
            throw new InboxError(
                "자동화가 변경되었습니다. 최신 설정을 확인해주세요.",
                409,
            );
        if (workflow.enabled)
            throw new InboxError("이미 켜져 있는 자동화입니다.", 409);
        if (!workflow.activeRevisionId)
            throw new InboxError(
                "게시한 버전이 없습니다. 모의 실행 후 게시해주세요.",
                409,
            );
        const revision = await workflowRevision(
            id,
            workflow.activeRevisionId,
            tx,
        );
        const [preview] = await tx
            .select({ id: previews.id })
            .from(previews)
            .where(
                and(
                    eq(previews.workflowId, id),
                    eq(previews.revisionId, revision.id),
                    eq(previews.passed, true),
                    eq(previews.fingerprint, revision.fingerprint),
                ),
            )
            .limit(1);
        if (!revision.publishedAt || !preview)
            throw new InboxError(
                "게시 당시 모의 실행 결과를 확인할 수 없습니다. 새 버전으로 저장한 뒤 다시 게시해주세요.",
                409,
            );
        await validateWorkflowReferences(
            actor.orgId,
            workflow.workspaceId,
            revision.definition.steps,
            tx,
        );
        const count = await tx
            .select({ id: workflows.id })
            .from(workflows)
            .where(
                and(
                    eq(workflows.workspaceId, workflow.workspaceId),
                    eq(workflows.enabled, true),
                ),
            );
        if (count.length >= 100)
            throw new InboxError(
                "사업별 활성 자동화는 100개까지 사용할 수 있습니다.",
            );
        await tx
            .update(workflows)
            .set({
                enabled: true,
                generation: workflow.generation + 1,
                version: workflow.version + 1,
                updatedAt: new Date(),
            })
            .where(eq(workflows.id, id));
        await tx.insert(audit).values({
            workflowId: id,
            actorName: actor.name,
            action: "enabled",
            detail: {
                revisionId: revision.id,
                previewId: preview.id,
                generation: workflow.generation + 1,
            },
        });
        return { enabled: true };
    });
}
export async function workflowRunPage(
    actor: SalesActor,
    id: string,
    before?: string,
    exec: DbExec = db,
) {
    await workflowOwned(actor, id, exec);
    let cursor;
    if (before) {
        [cursor] = await exec
            .select()
            .from(runs)
            .where(and(eq(runs.workflowId, id), eq(runs.id, before)));
        if (!cursor)
            throw new InboxError("실행 이력 위치를 찾을 수 없습니다.", 404);
    }
    const rows = await exec
        .select({
            id: runs.id,
            revisionId: runs.revisionId,
            eventId: runs.eventId,
            state: runs.state,
            cursor: runs.cursor,
            attempts: runs.attempts,
            reason: runs.reason,
            eligibleAt: runs.eligibleAt,
            createdAt: runs.createdAt,
            updatedAt: runs.updatedAt,
        })
        .from(runs)
        .where(
            and(
                eq(runs.workflowId, id),
                cursor
                    ? or(
                          lt(runs.createdAt, cursor.createdAt),
                          and(
                              eq(runs.createdAt, cursor.createdAt),
                              lt(runs.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(runs.createdAt), desc(runs.id))
        .limit(50);
    return { rows, hasMore: rows.length === 50 };
}
export async function workflowRunDetail(
    actor: SalesActor,
    id: string,
    runId: string,
    exec: DbExec = db,
) {
    await workflowOwned(actor, id, exec);
    const [run] = await exec
        .select()
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.workflowId, id)));
    if (!run) throw new InboxError("실행 이력을 찾을 수 없습니다.", 404);
    const actions = await exec
            .select()
            .from(steps)
            .where(eq(steps.runId, run.id))
            .orderBy(steps.position),
        revision = await workflowRevision(id, run.revisionId, exec),
        history = await exec
            .select()
            .from(audit)
            .where(
                and(
                    eq(audit.workflowId, id),
                    sql`${audit.detail}->>'runId'=${runId}`,
                ),
            )
            .orderBy(desc(audit.createdAt), desc(audit.id))
            .limit(100);
    const { leaseId: _, ...safe } = run;
    void _;
    return { run: safe, revision, steps: actions, history };
}
export async function changeWorkflowRun(
    actor: SalesActor,
    id: string,
    runId: string,
    action: "cancel" | "retry",
    exec: DbExec = db,
) {
    const hint = await workflowOwned(actor, id, exec);
    await requireCustomerAccess(actor, hint.workspaceId, "manage", exec);
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, hint.workspaceId, tx);
        const workflow = await workflowOwned(actor, id, tx),
            [run] = await tx
                .select()
                .from(runs)
                .where(and(eq(runs.id, runId), eq(runs.workflowId, id)))
                .for("update");
        if (!run) throw new InboxError("실행 이력을 찾을 수 없습니다.", 404);
        if (
            (action === "cancel" && !activeRunStates.includes(run.state)) ||
            (action === "retry" &&
                (run.state !== "failed" ||
                    !workflow.enabled ||
                    run.generation !== workflow.generation ||
                    run.revisionId !== workflow.activeRevisionId))
        )
            throw new InboxError(
                "현재 실행에는 이 작업을 적용할 수 없습니다.",
                409,
            );
        await tx
            .update(runs)
            .set({
                state: action === "cancel" ? "cancelled" : "queued",
                leaseId: null,
                leaseUntil: null,
                attempts: 0,
                eligibleAt: new Date(),
                reason:
                    action === "cancel"
                        ? "관리자가 실행을 취소했습니다."
                        : null,
                updatedAt: new Date(),
            })
            .where(eq(runs.id, runId));
        await tx.insert(audit).values({
            workflowId: id,
            actorName: actor.name,
            action: `run.${action}`,
            detail: { runId, cursor: run.cursor },
        });
        return { changed: true };
    });
}
