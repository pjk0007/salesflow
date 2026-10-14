import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, organizationMembers } from "@/lib/db";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import {
    authenticatePlatform,
    authorizeWorkspace,
} from "@/lib/customer-platform/external-auth";
import type { PlatformPermission } from "@/lib/customer-platform/rules";
import {
    createMailbox,
    listMailboxes,
    ownedMailbox,
    changeMailbox,
    receiveEmail,
    claimEmail,
    emailDeliveryMailbox,
    changeEmailDelivery,
} from "./repository";
type Context = { params: Promise<{ id: string }> };
async function actorFor(
    req: NextRequest,
    external: boolean,
    workspaceId: number,
    permissions: PlatformPermission[],
    admin = false,
) {
    if (!external) {
        const actor = inboxActor(req);
        if (admin && actor.role === "member")
            throw new InboxError("관리자만 메일함을 설정할 수 있습니다.", 403);
        return actor;
    }
    const ctx = await authenticatePlatform(req);
    for (const permission of permissions)
        await authorizeWorkspace(ctx, workspaceId, permission);
    if (admin) {
        const [member] = await db
            .select({ role: organizationMembers.role })
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.organizationId, ctx.actor.orgId),
                    eq(organizationMembers.userId, ctx.actor.userId),
                ),
            );
        if (!member || !["admin", "owner"].includes(member.role))
            throw new InboxError(
                "관리자 발급 토큰만 메일함을 설정할 수 있습니다.",
                403,
            );
    }
    return ctx.actor;
}
const preliminaryActor = async (req: NextRequest, external: boolean) =>
    external ? (await authenticatePlatform(req)).actor : inboxActor(req);
const idOf = async (c: Context) =>
    z
        .string()
        .uuid()
        .parse((await c.params).id);
export function mailboxCollection(external: boolean) {
    return {
        GET: (req: NextRequest) =>
            handleInbox(async () => {
                const workspaceId = z.coerce
                    .number()
                    .int()
                    .positive()
                    .parse(req.nextUrl.searchParams.get("workspaceId"));
                return listMailboxes(
                    await actorFor(req, external, workspaceId, ["read"]),
                    workspaceId,
                );
            }),
        POST: (req: NextRequest) =>
            handleInbox(async () => {
                const body = await jsonBody(req),
                    workspaceId = z
                        .number()
                        .int()
                        .positive()
                        .parse(body.workspaceId);
                return createMailbox(
                    await actorFor(
                        req,
                        external,
                        workspaceId,
                        ["create"],
                        true,
                    ),
                    body,
                );
            }),
    };
}
export function mailboxItem(external: boolean) {
    return {
        POST: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const id = await idOf(c),
                    box = await ownedMailbox(
                        await preliminaryActor(req, external),
                        id,
                    );
                return changeMailbox(
                    await actorFor(
                        req,
                        external,
                        box.workspaceId,
                        ["update"],
                        true,
                    ),
                    id,
                    await jsonBody(req),
                );
            }),
    };
}
export function mailboxRelay(action: "receive" | "claim") {
    return {
        POST: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const id = await idOf(c),
                    box = await ownedMailbox(
                        await preliminaryActor(req, true),
                        id,
                    );
                const actor = await actorFor(
                    req,
                    true,
                    box.workspaceId,
                    action === "receive" ? ["create"] : ["read", "update"],
                );
                return action === "receive"
                    ? receiveEmail(actor, id, await jsonBody(req, 200000))
                    : claimEmail(actor, id);
            }),
    };
}
export function deliveryItem(external: boolean) {
    return {
        POST: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const id = await idOf(c),
                    box = await emailDeliveryMailbox(
                        await preliminaryActor(req, external),
                        id,
                    );
                const raw = await jsonBody(req);
                if (!external && !["retry", "cancel"].includes(raw.action))
                    throw new InboxError(
                        "발송 결과는 메일 연결 서버에서 확인합니다.",
                        403,
                    );
                return changeEmailDelivery(
                    await actorFor(req, external, box.workspaceId, [
                        "read",
                        "update",
                    ]),
                    id,
                    raw,
                );
            }),
    };
}
