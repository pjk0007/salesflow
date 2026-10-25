import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import {
    db,
    workspaces,
    inboxChannels,
    inboxConversations,
    customerWorkspaceAccess as grants,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload, OrgRole } from "@/types";
import {
    checkTokenVersion,
    isTokenVersionAcceptable,
} from "@/lib/auth-admin-rules";
import { findActiveMembership } from "@/lib/auth";
import { InboxError } from "@/lib/inbox/errors";
import {
    permitsCustomerRole,
    customerAbilities,
    type CustomerCapability,
    type WorkspaceRole,
} from "./rules";
export type CustomerActor = Pick<
    JWTPayload,
    "orgId" | "userId" | "name" | "role"
> &
    Pick<Partial<JWTPayload>, "tokenVersion" | "membershipId">;
export async function activeCustomerActor(
    actor: CustomerActor,
    exec: DbExec = db,
) {
    const member = await findActiveMembership(actor.orgId, actor.userId, exec);
    if (
        !member ||
        (actor.membershipId !== undefined && actor.membershipId !== member.membershipId) ||
        !isTokenVersionAcceptable(
            checkTokenVersion(actor.tokenVersion, member.tokenVersion),
        )
    )
        throw new InboxError(
            "세션이 만료되었습니다. 다시 로그인해주세요.",
            401,
        );
    return { ...actor, role: member.role as OrgRole };
}
export async function customerStaffActor(
    orgId: string,
    userId: string,
    name: string,
    exec: DbExec = db,
) {
    const member = await findActiveMembership(orgId, userId, exec);
    if (!member) throw new InboxError("현재 직원 권한을 확인해주세요.", 403);
    return {
        orgId,
        userId,
        name,
        role: member.role as OrgRole,
        tokenVersion: member.tokenVersion,
        membershipId: member.membershipId,
    };
}
export async function requireCustomerAccess(
    actor: CustomerActor,
    workspaceId: number,
    capability: CustomerCapability = "read",
    exec: DbExec = db,
) {
    const [workspace] = await exec
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
            and(
                eq(workspaces.id, workspaceId),
                eq(workspaces.orgId, actor.orgId),
            ),
        );
    if (!workspace) throw new InboxError("사업을 찾을 수 없습니다.", 404);
    const current = await activeCustomerActor(actor, exec);
    let role: WorkspaceRole = "manager";
    if (current.role === "member") {
        const [grant] = await exec
            .select({ role: grants.role })
            .from(grants)
            .where(
                and(
                    eq(grants.orgId, actor.orgId),
                    eq(grants.workspaceId, workspaceId),
                    eq(grants.userId, actor.userId),
                ),
            );
        role = grant?.role ?? "none";
    }
    if (!permitsCustomerRole(role, capability))
        throw new InboxError(
            capability === "read"
                ? "이 사업의 고객 업무 접근 권한이 없습니다."
                : capability === "respond"
                  ? "이 사업의 응대·편집 권한이 필요합니다."
                  : "이 사업의 운영 관리 권한이 필요합니다.",
            403,
        );
    return {
        ...current,
        workspaceRole: role,
        abilities: customerAbilities(role),
    };
}
export async function requireCustomerChannel(
    actor: CustomerActor,
    channelId: number,
    capability: CustomerCapability = "read",
    exec: DbExec = db,
) {
    const [channel] = await exec
        .select()
        .from(inboxChannels)
        .where(
            and(
                eq(inboxChannels.orgId, actor.orgId),
                eq(inboxChannels.id, channelId),
            ),
        );
    if (!channel) throw new InboxError("상담창을 찾을 수 없습니다.", 404);
    await requireCustomerAccess(actor, channel.workspaceId, capability, exec);
    return channel;
}
export async function requireCustomerConversation(
    actor: CustomerActor,
    id: string,
    capability: CustomerCapability = "read",
    exec: DbExec = db,
) {
    const [chat] = await exec
        .select({ channelId: inboxConversations.channelId })
        .from(inboxConversations)
        .where(
            and(
                eq(inboxConversations.orgId, actor.orgId),
                eq(inboxConversations.id, id),
            ),
        );
    if (!chat) throw new InboxError("상담을 찾을 수 없습니다.", 404);
    return requireCustomerChannel(actor, chat.channelId, capability, exec);
}
// SQL predicate for aggregate/list/recipient queries: live membership and active staff, never JWT role.
export function customerAccessPredicate(
    orgId: string | SQLWrapper,
    userId: string | SQLWrapper,
    workspaceId: SQLWrapper,
    capability: CustomerCapability = "read",
) {
    const roles =
        capability === "read"
            ? sql`('viewer','agent','manager')`
            : capability === "respond"
              ? sql`('agent','manager')`
              : sql`('manager')`;
    return sql`EXISTS (SELECT 1 FROM organization_members cam JOIN users cau ON cau.id=cam.user_id
        WHERE cam.organization_id=${orgId}::uuid AND cam.user_id=${userId}::uuid AND cau.is_active=1
        AND (cam.role IN ('owner','admin') OR EXISTS (SELECT 1 FROM customer_workspace_access cag
            WHERE cag.org_id=cam.organization_id AND cag.user_id=cam.user_id AND cag.workspace_id=${workspaceId} AND cag.role IN ${roles})))`;
}
