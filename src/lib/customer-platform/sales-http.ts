import {
    customerObjectDetail,
    patchCustomerObject,
    archiveCustomerObject,
} from "@/lib/customer-records/repository";
import { objectListInput } from "@/lib/customer-records/rules";
import { requireCustomerAccess } from "@/lib/customer-access/access";
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import { authenticatePlatform, authorizeWorkspace } from "./external-auth";
import {
    listPlatformObjects,
    upsertContact,
    upsertCompany,
} from "./repository";
import {
    createSales,
    listSales,
    patchSales,
    salesDetail,
} from "./sales-repository";
type Context = { params: Promise<{ resource: string; id?: string }> };
export function salesHandler(external: boolean) {
    return async (req: NextRequest, context: Context) =>
        handleInbox(async () => {
            const params = await context.params,
                resource = z
                    .enum([
                        "pipelines",
                        "deals",
                        "tasks",
                        "contacts",
                        "companies",
                    ])
                    .parse(params.resource),
                id = params.id ? z.string().uuid().parse(params.id) : undefined;
            const body = req.method === "GET" ? undefined : await jsonBody(req),
                workspaceId = z.coerce
                    .number()
                    .int()
                    .positive()
                    .parse(
                        body?.workspaceId ??
                            req.nextUrl.searchParams.get("workspaceId"),
                    );
            const ctx = external ? await authenticatePlatform(req) : null,
                actor = ctx?.actor ?? inboxActor(req),
                permission =
                    req.method === "GET"
                        ? "read"
                        : id &&
                            (resource === "contacts" ||
                                resource === "companies") &&
                            req.method === "POST"
                          ? body?.action === "archive"
                              ? "delete"
                              : "update"
                          : req.method === "POST"
                            ? "create"
                            : "update";
            if (ctx) await authorizeWorkspace(ctx, workspaceId, permission);
            else
                await requireCustomerAccess(
                    actor,
                    workspaceId,
                    permission === "read" ? "read" : "respond",
                );
            if (resource === "contacts" || resource === "companies") {
                if (id) {
                    if (req.method === "GET")
                        return customerObjectDetail(
                            actor,
                            workspaceId,
                            resource,
                            id,
                            req.nextUrl.searchParams.get("before") ?? undefined,
                        );
                    const { workspaceId: _, ...change } = body;
                    void _;
                    if (req.method === "PATCH")
                        return patchCustomerObject(
                            actor,
                            workspaceId,
                            resource,
                            id,
                            change,
                            undefined,
                            external ? "api" : "staff",
                        );
                    if (req.method === "POST")
                        return archiveCustomerObject(
                            actor,
                            workspaceId,
                            resource,
                            id,
                            change,
                            undefined,
                            external ? "api" : "staff",
                        );
                }
                if (external)
                    throw new InboxError(
                        "이 고객 API 경로를 확인해주세요.",
                        404,
                    );
                if (req.method === "GET" && !id) {
                    const before = req.nextUrl.searchParams.get("before");
                    return listPlatformObjects(
                        actor.orgId,
                        workspaceId,
                        resource,
                        before ? z.string().uuid().parse(before) : undefined,
                        undefined,
                        z
                            .string()
                            .trim()
                            .max(200)
                            .parse(req.nextUrl.searchParams.get("q") ?? ""),
                        objectListInput.parse({
                            archived:
                                req.nextUrl.searchParams.get("archived") ??
                                undefined,
                        }).archived,
                    );
                }
                if (req.method === "POST" && !id)
                    return resource === "contacts"
                        ? upsertContact(actor.orgId, body, true, undefined, {
                              actor,
                              source: "staff",
                          })
                        : upsertCompany(actor.orgId, body, true, undefined, {
                              actor,
                              source: "staff",
                          });
                throw new InboxError("지원하지 않는 고객 요청입니다.", 405);
            }
            if (resource === "pipelines" && req.method !== "GET")
                await requireCustomerAccess(actor, workspaceId, "manage");
            if (req.method === "GET") {
                const before = req.nextUrl.searchParams.get("before");
                if (id)
                    return salesDetail(
                        actor,
                        workspaceId,
                        resource,
                        id,
                        before ? z.string().uuid().parse(before) : undefined,
                    );
                return listSales(
                    actor,
                    workspaceId,
                    resource,
                    Object.fromEntries(
                        [
                            "q",
                            "before",
                            "pipelineId",
                            "status",
                            "archived",
                        ].flatMap((key) =>
                            req.nextUrl.searchParams.has(key)
                                ? [[key, req.nextUrl.searchParams.get(key)]]
                                : [],
                        ),
                    ),
                );
            }
            if (req.method === "POST" && !id)
                return createSales(actor, resource, body);
            if (req.method === "PATCH" && id) {
                const { workspaceId: _, ...change } = body;
                void _;
                return patchSales(actor, workspaceId, resource, id, change);
            }
            throw new InboxError("지원하지 않는 영업 요청입니다.", 405);
        });
}
