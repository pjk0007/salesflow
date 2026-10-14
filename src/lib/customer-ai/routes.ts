import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, customerAiJobs } from "@/lib/db";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import { supportActor, supportKnowledgeBody } from "./http";
import {
    supportCatalog,
    saveSupportSettings,
    listSupportKnowledge,
    manageSupportKnowledge,
} from "./catalog";
import { queueSupportJob } from "./queue";
import { supportJobPage, supportJobDetail } from "./queries";
import { processSupportJob } from "./worker";
const uuid = z.string().uuid("ID 형식을 확인해주세요.");
const workspace = z.coerce.number().int().positive("사업을 선택해주세요.");
type C = { params: Promise<{ id: string; runId?: string }> };
export function supportSettingsHandlers(external: boolean) {
    return {
        GET: (req: NextRequest) =>
            handleInbox(async () => {
                const workspaceId = workspace.parse(
                    req.nextUrl.searchParams.get("workspaceId"),
                );
                return supportCatalog(
                    await supportActor(req, external, { workspaceId }),
                    workspaceId,
                );
            }),
        POST: (req: NextRequest) =>
            handleInbox(async () => {
                const { workspaceId: raw, ...input } = await jsonBody(req),
                    workspaceId = workspace.parse(raw);
                return saveSupportSettings(
                    await supportActor(req, external, { workspaceId }, true),
                    workspaceId,
                    input,
                );
            }),
    };
}
export function supportKnowledgeHandlers(external: boolean) {
    return {
        GET: (req: NextRequest) =>
            handleInbox(async () => {
                const workspaceId = workspace.parse(
                    req.nextUrl.searchParams.get("workspaceId"),
                );
                return listSupportKnowledge(
                    await supportActor(req, external, { workspaceId }),
                    workspaceId,
                    req.nextUrl.searchParams.has("before")
                        ? z.coerce
                              .number()
                              .int()
                              .positive()
                              .parse(req.nextUrl.searchParams.get("before"))
                        : undefined,
                );
            }),
        POST: (req: NextRequest) =>
            handleInbox(async () => {
                const input = z
                    .object({
                        workspaceId: z.number().int().positive(),
                        name: z.string().trim().min(1).max(120),
                        snapshot: z.unknown(),
                    })
                    .strict()
                    .parse(await supportKnowledgeBody(req));
                return manageSupportKnowledge(
                    await supportActor(
                        req,
                        external,
                        { workspaceId: input.workspaceId },
                        true,
                        true,
                    ),
                    input.workspaceId,
                    { action: "create", ...input },
                );
            }),
    };
}
export function supportKnowledgeVersionHandlers(external: boolean) {
    return {
        POST: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const id = z.coerce
                        .number()
                        .int()
                        .positive()
                        .parse((await c.params).id),
                    input = z
                        .object({
                            workspaceId: z.number().int().positive(),
                            action: z.enum(["approve", "block"]),
                            reason: z
                                .string()
                                .trim()
                                .min(10)
                                .max(1000)
                                .optional(),
                        })
                        .strict()
                        .parse(await jsonBody(req));
                return manageSupportKnowledge(
                    await supportActor(
                        req,
                        external,
                        { workspaceId: input.workspaceId },
                        true,
                    ),
                    input.workspaceId,
                    { id, ...input },
                );
            }),
    };
}
export function supportConversationHandlers(external: boolean) {
    return {
        GET: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const id = uuid.parse((await c.params).id);
                return supportJobPage(
                    await supportActor(req, external, { conversationId: id }),
                    id,
                    req.nextUrl.searchParams.has("before")
                        ? uuid.parse(req.nextUrl.searchParams.get("before"))
                        : undefined,
                );
            }),
        POST: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const id = uuid.parse((await c.params).id),
                    actor = await supportActor(
                        req,
                        external,
                        { conversationId: id },
                        false,
                        true,
                    ),
                    input = z
                        .object({ clientId: uuid })
                        .strict()
                        .parse(await jsonBody(req)),
                    job = await queueSupportJob(actor, id, input.clientId);
                await processSupportJob(job.id);
                return { jobId: job.id };
            }),
    };
}
export function supportRunHandlers(external: boolean) {
    return {
        GET: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const params = await c.params,
                    id = uuid.parse(params.id),
                    runId = uuid.parse(params.runId);
                return supportJobDetail(
                    await supportActor(req, external, { conversationId: id }),
                    runId,
                    id,
                );
            }),
        POST: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const params = await c.params,
                    id = uuid.parse(params.id),
                    runId = uuid.parse(params.runId),
                    actor = await supportActor(
                        req,
                        external,
                        { conversationId: id },
                        false,
                        false,
                        "update",
                    );
                z.literal("cancel").parse((await jsonBody(req)).action);
                const [updated] = await db
                    .update(customerAiJobs)
                    .set({
                        state: "cancelled",
                        reason: "상담원이 생성을 취소했습니다.",
                        leaseId: null,
                        leaseUntil: null,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(customerAiJobs.id, runId),
                            eq(customerAiJobs.conversationId, id),
                            eq(customerAiJobs.orgId, actor.orgId),
                            inArray(customerAiJobs.state, [
                                "queued",
                                "generating",
                                "ready",
                            ]),
                        ),
                    )
                    .returning({ id: customerAiJobs.id });
                if (!updated)
                    throw new InboxError(
                        "취소할 수 있는 AI 생성이 아닙니다.",
                        409,
                    );
                return updated;
            }),
    };
}
