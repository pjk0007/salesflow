import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, organizationMembers } from "@/lib/db";
import { inboxActor } from "@/lib/inbox/http";
import { requireAdmin } from "@/lib/auth-admin";
import { InboxError } from "@/lib/inbox/errors";
import { authenticatePlatform, authorizeWorkspace } from "./external-auth";
import { ownedWebhook, ownedDelivery } from "./webhook-repository";
export async function webhookActor(
    req: NextRequest,
    external: boolean,
    scope: { workspaceId?: number; endpointId?: string; deliveryId?: string },
    manage = false,
    create = false,
) {
    let actor, ctx;
    if (external) {
        ctx = await authenticatePlatform(req);
        actor = ctx.actor;
        if (manage) {
            const [member] = await db
                .select({ role: organizationMembers.role })
                .from(organizationMembers)
                .where(
                    and(
                        eq(organizationMembers.organizationId, actor.orgId),
                        eq(organizationMembers.userId, actor.userId),
                    ),
                );
            if (!member || !["admin", "owner"].includes(member.role))
                throw new InboxError(
                    "관리자 발급 토큰만 외부 연동을 변경할 수 있습니다.",
                    403,
                );
        }
    } else {
        inboxActor(req);
        const result = await requireAdmin(req, manage ? "admin" : "member");
        if (!result.ok) throw new InboxError(result.error, result.status);
        actor = result.user;
    }
    const workspaceId =
        scope.workspaceId ??
        (scope.endpointId
            ? (await ownedWebhook(actor, scope.endpointId)).workspaceId
            : scope.deliveryId
              ? (await ownedDelivery(actor, scope.deliveryId)).workspaceId
              : undefined);
    if (ctx && workspaceId)
        await authorizeWorkspace(
            ctx,
            workspaceId,
            manage ? (create ? "create" : "update") : "read",
        );
    return actor;
}
