import { customerAccessPredicate } from "@/lib/customer-access/access";
import { and, eq, sql } from "drizzle-orm";
import { db, users, organizationMembers, crmPipelines } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
import { patchConversation, sendSystemReply } from "@/lib/inbox/repository";
import {
    createSales,
    patchSales,
    type SalesActor,
} from "@/lib/customer-platform/sales-repository";
import {
    upsertContact,
    recordCustomerEvent,
} from "@/lib/customer-platform/repository";
import { requestUuid } from "@/lib/customer-ai/rules";
import { type WorkflowStep, conditionValue, templatePaths } from "./rules";
import type { LoadedWorkflowContext } from "./context";
export async function validateWorkflowReferences(
    orgId: string,
    workspaceId: number,
    steps: WorkflowStep[],
    exec: DbExec = db,
) {
    for (const step of steps) {
        const texts =
            step.kind === "reply"
                ? [step.body]
                : step.kind === "task"
                  ? [step.title, step.body]
                  : [];
        for (const text of texts) {
            const remainder = text.replace(
                /\{\{\s*([\w.]+)\s*\}\}/g,
                (_, p: string) => {
                    if (!templatePaths.includes(p))
                        throw new InboxError(
                            "자동화 문구의 개인화 변수를 확인해주세요.",
                        );
                    return "";
                },
            );
            if (remainder.includes("{{") || remainder.includes("}}"))
                throw new InboxError(
                    "개인화 변수의 괄호와 이름을 확인해주세요.",
                );
        }
        const person =
            step.kind === "assign"
                ? step.assigneeId
                : step.kind === "task"
                  ? step.ownerId
                  : null;
        if (person) {
            const [user] = await exec
                .select({ id: users.id })
                .from(users)
                .innerJoin(
                    organizationMembers,
                    eq(organizationMembers.userId, users.id),
                )
                .where(
                    and(
                        eq(users.id, person),
                        eq(users.isActive, 1),
                        eq(organizationMembers.organizationId, orgId),
                        customerAccessPredicate(
                            orgId,
                            users.id,
                            sql`${workspaceId}`,
                            "respond",
                        ),
                    ),
                );
            if (!user)
                throw new InboxError(
                    "자동화 담당자는 같은 조직의 활성 팀원이어야 합니다.",
                );
        }
        if (step.kind === "deal_stage") {
            const [pipeline] = await exec
                .select()
                .from(crmPipelines)
                .where(
                    and(
                        eq(crmPipelines.id, step.pipelineId),
                        eq(crmPipelines.orgId, orgId),
                        eq(crmPipelines.workspaceId, workspaceId),
                    ),
                );
            if (!pipeline?.stages.some((s) => s.id === step.stageId))
                throw new InboxError(
                    "같은 사업의 유효한 파이프라인과 단계를 선택해주세요.",
                );
        }
    }
}
export function stepTargetProblem(
    step: WorkflowStep,
    ctx: LoadedWorkflowContext,
    now = new Date(),
) {
    if (
        ["tag", "assign", "status", "handoff", "reply"].includes(step.kind) &&
        (!ctx.conversation || !ctx.conversation.enabled)
    )
        return "사용 중인 상담이 없습니다.";
    if (["contact_stage", "event"].includes(step.kind) && !ctx.contact)
        return "연결된 고객이 없습니다.";
    if (
        step.kind === "task" &&
        !ctx.contact &&
        !ctx.company &&
        !ctx.conversation &&
        !ctx.deal
    )
        return "업무를 연결할 고객·회사·상담이 없습니다.";
    if (
        step.kind === "deal_stage" &&
        (!ctx.deal ||
            ctx.deal.archivedAt ||
            ctx.deal.pipelineId !== step.pipelineId)
    )
        return "대상 딜의 파이프라인이 다르거나 보관된 상태입니다.";
    if (step.kind === "reply") {
        if (ctx.conversation?.medium !== "web")
            return "이메일 상담은 상담원이 검토한 답장만 발송합니다.";
        if (
            !Number.isFinite(Date.parse(String(ctx.event.occurredAt))) ||
            now.getTime() - Date.parse(String(ctx.event.occurredAt)) > 86400000
        )
            return "24시간이 지난 문의에는 자동 안내를 보내지 않습니다.";
        const data = ctx.event.data as Record<string, unknown> | undefined,
            message = data?.message as
                | { kind?: string; id?: number; attachments?: unknown[] }
                | undefined;
        if (
            ctx.event.type !== "message.created" ||
            message?.kind !== "customer"
        )
            return "자동 안내는 고객 메시지에만 응답합니다.";
        if (message.attachments?.length)
            return "첨부 자료는 상담원이 확인해야 합니다.";
        if (
            ctx.conversation?.status !== "open" ||
            ctx.conversation?.aiState === "human" ||
            message.id !== ctx.conversation?.lastPublicId
        )
            return "새 대화 또는 사람 응대가 있어 자동 안내를 보내지 않습니다.";
    }
    return null;
}
export function renderWorkflowText(
    text: string,
    ctx: LoadedWorkflowContext,
    maxLength = 2500,
) {
    const rendered = text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p: string) => {
        if (!templatePaths.includes(p))
            throw new InboxError("자동화 문구의 개인화 변수를 확인해주세요.");
        const v = conditionValue(ctx, p);
        return v === null || v === undefined ? "" : String(v);
    });
    if (rendered.length > maxLength)
        throw new InboxError("개인화한 문구가 너무 깁니다. 내용을 줄여주세요.");
    return rendered;
}
export async function executeWorkflowAction(
    exec: DbExec,
    actor: SalesActor,
    workspaceId: number,
    runId: string,
    step: WorkflowStep,
    ctx: LoadedWorkflowContext,
    now: Date,
) {
    const reason = stepTargetProblem(step, ctx, now);
    if (reason) return { skipped: true, reason };
    if (step.kind === "wait")
        return {
            waitUntil: new Date(
                now.getTime() + step.minutes * 60000,
            ).toISOString(),
        };
    if (step.kind === "task") {
        const task = await createSales(
            actor,
            "tasks",
            {
                workspaceId,
                externalId: `workflow:${runId}:${step.id}`,
                title: renderWorkflowText(step.title, ctx, 200),
                body:
                    renderWorkflowText(step.body, ctx, 2000) +
                    (ctx.conversation
                        ? `\n\n연결 상담: /inbox?channelId=${ctx.conversation.channelId}&conversation=${ctx.conversation.id}`
                        : ""),
                contactId: ctx.contact?.id ?? null,
                companyId: ctx.company?.id ?? null,
                dealId: ctx.deal?.id ?? null,
                ownerId: step.ownerId,
                dueAt: step.dueMinutes
                    ? new Date(
                          now.getTime() + step.dueMinutes * 60000,
                      ).toISOString()
                    : null,
            },
            exec,
        );
        return {
            taskId: task.id,
            title: renderWorkflowText(step.title, ctx, 200),
            conversationId: ctx.conversation?.id ?? null,
            channelId: ctx.conversation?.channelId ?? null,
        };
    }
    if (step.kind === "contact_stage") {
        const c = ctx.contact!;
        const saved = await upsertContact(
            actor.orgId,
            {
                workspaceId,
                externalId: c.externalId,
                name: c.name,
                lifecycleStage: step.stage,
                version: c.version,
            },
            true,
            exec,
            { actor, source: "workflow" },
        );
        return { contactId: saved.id, stage: step.stage };
    }
    if (step.kind === "deal_stage") {
        const deal = ctx.deal!;
        await patchSales(
            actor,
            workspaceId,
            "deals",
            deal.id,
            { version: deal.version, stageId: step.stageId },
            exec,
        );
        return { dealId: deal.id, stageId: step.stageId };
    }
    if (step.kind === "event") {
        const event = await recordCustomerEvent(
            actor.orgId,
            workspaceId,
            ctx.contact!.id,
            {
                eventId: requestUuid(`workflow:${runId}:${step.id}`),
                name: step.name,
                properties: { workflowRunId: runId },
            },
            "server",
            exec,
        );
        return { eventId: event.id };
    }
    if (step.kind === "reply") {
        const message = await sendSystemReply(
            exec,
            ctx.conversation!.id,
            renderWorkflowText(step.body, ctx),
            requestUuid(`workflow:${runId}:${step.id}`),
            undefined,
            "자동 안내",
        );
        return {
            messageId: message.id,
            conversationId: ctx.conversation!.id,
            channelId: ctx.conversation!.channelId,
        };
    }
    const chat = ctx.conversation!;
    const change =
        step.kind === "tag"
            ? {
                  tags: step.remove
                      ? chat.tags.filter((t) => t !== step.tag)
                      : [...new Set([...chat.tags, step.tag])],
              }
            : step.kind === "assign"
              ? { assigneeId: step.assigneeId }
              : step.kind === "status"
                ? { status: step.status }
                : { aiState: "human", priority: true, status: "open" };
    await patchConversation(
        actor,
        chat.id,
        { version: chat.version, ...change },
        exec,
    );
    return { conversationId: chat.id, channelId: chat.channelId, ...change };
}
