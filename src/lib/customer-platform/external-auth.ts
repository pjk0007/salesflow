import { requireCustomerAccess } from "@/lib/customer-access/access";
import type { OrgRole } from "@/types";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
    db,
    apiTokens,
    users,
    organizationMembers,
    inboxChannels,
    inboxConversations,
} from "@/lib/db";
import { getApiTokenFromNextRequest, resolveApiToken } from "@/lib/auth";
import { InboxError } from "@/lib/inbox/errors";
import { canAccessWorkspace, type PlatformPermission } from "./rules";
import { requirePlatformWorkspace } from "./repository";
export async function authenticatePlatform(req: NextRequest) {
    const raw = getApiTokenFromNextRequest(req),
        token = raw ? await resolveApiToken(raw) : null;
    if (!token)
        throw new InboxError("유효한 서비스 API 토큰이 필요합니다.", 401);
    const [issuer] = await db
        .select({
            userId: users.id,
            name: apiTokens.name,
            role: organizationMembers.role,
            tokenVersion: organizationMembers.tokenVersion,
        })
        .from(apiTokens)
        .innerJoin(users, eq(users.id, apiTokens.createdBy))
        .innerJoin(
            organizationMembers,
            and(
                eq(organizationMembers.userId, users.id),
                eq(organizationMembers.organizationId, apiTokens.orgId),
            ),
        )
        .where(
            and(
                eq(apiTokens.id, token.id),
                eq(apiTokens.orgId, token.orgId),
                eq(users.isActive, 1),
            ),
        );
    if (!issuer)
        throw new InboxError("사용할 수 없는 서비스 API 토큰입니다.", 401);
    return {
        token,
        actor: {
            orgId: token.orgId,
            userId: issuer.userId,
            name: `API · ${issuer.name}`.slice(0, 100),
            role: issuer.role as OrgRole,
            tokenVersion: issuer.tokenVersion,
        },
    };
}
export type PlatformContext = Awaited<ReturnType<typeof authenticatePlatform>>;
export async function authorizeWorkspace(
    ctx: PlatformContext,
    workspaceId: number,
    permission: PlatformPermission,
) {
    await requirePlatformWorkspace(ctx.token.orgId, workspaceId);
    await requireCustomerAccess(
        ctx.actor,
        workspaceId,
        permission === "read" ? "read" : "respond",
    );
    if (!canAccessWorkspace(ctx.token.scopes, workspaceId, permission))
        throw new InboxError("이 사업의 API 권한이 없습니다.", 403);
}
export async function authorizeChannel(
    ctx: PlatformContext,
    id: number,
    permission: PlatformPermission,
) {
    const [channel] = await db
        .select()
        .from(inboxChannels)
        .where(
            and(
                eq(inboxChannels.id, id),
                eq(inboxChannels.orgId, ctx.token.orgId),
            ),
        );
    if (!channel) throw new InboxError("상담창을 찾을 수 없습니다.", 404);
    await authorizeWorkspace(ctx, channel.workspaceId, permission);
    return channel;
}
export async function authorizeConversation(
    ctx: PlatformContext,
    id: string,
    permission: PlatformPermission,
) {
    const [row] = await db
        .select({
            conversation: inboxConversations,
            workspaceId: inboxChannels.workspaceId,
        })
        .from(inboxConversations)
        .innerJoin(
            inboxChannels,
            eq(inboxChannels.id, inboxConversations.channelId),
        )
        .where(
            and(
                eq(inboxConversations.id, id),
                eq(inboxConversations.orgId, ctx.token.orgId),
                eq(inboxChannels.orgId, ctx.token.orgId),
            ),
        );
    if (!row) throw new InboxError("상담을 찾을 수 없습니다.", 404);
    await authorizeWorkspace(ctx, row.workspaceId, permission);
    return row.conversation;
}
