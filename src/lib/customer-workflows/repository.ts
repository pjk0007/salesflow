import { requireCustomerAccess } from "@/lib/customer-access/access";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
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
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
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
export async function workflowList(
    actor: SalesActor,
    workspaceId: number,
    before?: string,
    exec: DbExec = db,
) {
    await requireCustomerAccess(actor, workspaceId, "read", exec);
    const rows = await exec
        .select()
        .from(workflows)
        .where(
            and(
                eq(workflows.orgId, actor.orgId),
                eq(workflows.workspaceId, workspaceId),
                before ? lt(workflows.id, before) : undefined,
            ),
        )
        .orderBy(desc(workflows.id))
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
    return { workflow, revisions: versions, history };
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
                        context.conversation.assigneeId = step.assigneeId;
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
