import { and, eq, desc, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    workspaces,
    users,
    organizationMembers,
    customerWorkspaceAccess as grants,
    customerAccessAudit as audit,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
import { activeCustomerActor, type CustomerActor } from "./access";
import { workspaceRoles } from "./rules";
async function administrator(
    actor: CustomerActor,
    workspaceId: number,
    exec: DbExec,
) {
    const current = await activeCustomerActor(actor, exec);
    if (current.role === "member")
        throw new InboxError(
            "조직 관리자만 직원의 사업 권한을 배정할 수 있습니다.",
            403,
        );
    const [w] = await exec
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
            and(
                eq(workspaces.orgId, actor.orgId),
                eq(workspaces.id, workspaceId),
            ),
        );
    if (!w) throw new InboxError("사업을 찾을 수 없습니다.", 404);
}
export async function accessRoster(
    actor: CustomerActor,
    workspaceId: number,
    exec: DbExec = db,
    before?: string,
) {
    await administrator(actor, workspaceId, exec);
    const members = await exec
        .select({
            id: users.id,
            name: users.name,
            email: users.email,
            orgRole: organizationMembers.role,
            active: users.isActive,
            role: grants.role,
            version: grants.version,
            // 권한을 낮추기 전에 영향을 보여주기 위한 건수 — 이 직원이 게시한 활성 자동화(게시자 권한으로 실행된다)와
            // 아직 발송 대기 중인 이 직원의 메일 답장(응대 권한을 잃으면 취소된다)
            publishedWorkflows: sql<number>`(SELECT count(*)::int FROM customer_workflows cw JOIN customer_workflow_revisions cr ON cr.id = cw.active_revision_id WHERE cw.org_id = ${actor.orgId} AND cw.workspace_id = ${workspaceId} AND cw.enabled AND cr.published_by = ${users.id})`,
            pendingEmailReplies: sql<number>`(SELECT count(*)::int FROM inbox_email_deliveries ed JOIN inbox_mailboxes mb ON mb.id = ed.mailbox_id JOIN inbox_messages em ON em.id = ed.message_id WHERE mb.org_id = ${actor.orgId} AND mb.workspace_id = ${workspaceId} AND ed.state IN ('queued', 'leased') AND em.author_id = ${users.id})`,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .leftJoin(
            grants,
            and(
                eq(grants.orgId, actor.orgId),
                eq(grants.workspaceId, workspaceId),
                eq(grants.userId, users.id),
            ),
        )
        .where(eq(organizationMembers.organizationId, actor.orgId))
        .orderBy(users.name, users.id);
    const base = and(
        eq(audit.orgId, actor.orgId),
        eq(audit.workspaceId, workspaceId),
    );
    const [cursor] = before
        ? await exec
              .select()
              .from(audit)
              .where(and(base, eq(audit.id, z.uuid().parse(before))))
        : [];
    if (before && !cursor)
        throw new InboxError("권한 이력 위치를 확인해주세요.", 404);
    const history = await exec
        .select({
            id: audit.id,
            userId: audit.userId,
            name: users.name,
            actorName: audit.actorName,
            beforeRole: audit.beforeRole,
            afterRole: audit.afterRole,
            version: audit.version,
            createdAt: audit.createdAt,
        })
        .from(audit)
        .innerJoin(users, eq(users.id, audit.userId))
        .where(
            and(
                base,
                cursor
                    ? or(
                          lt(audit.createdAt, cursor.createdAt),
                          and(
                              eq(audit.createdAt, cursor.createdAt),
                              lt(audit.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(audit.createdAt), desc(audit.id))
        .limit(50);
    return {
        members: members.map((m) => ({
            ...m,
            role: m.orgRole === "member" ? (m.role ?? "none") : "manager",
            version: m.version ?? 0,
        })),
        history,
        hasMore: history.length === 50,
    };
}
export async function changeAccess(
    actor: CustomerActor,
    workspaceId: number,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = z
        .object({
            userId: z.uuid(),
            role: z.enum(workspaceRoles),
            version: z.number().int().nonnegative(),
        })
        .strict()
        .parse(raw);
    return exec.transaction(async (tx) => {
        await administrator(actor, workspaceId, tx);
        await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .for("update");
        const [target] = await tx
            .select({ role: organizationMembers.role, active: users.isActive })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(
                and(
                    eq(organizationMembers.organizationId, actor.orgId),
                    eq(organizationMembers.userId, input.userId),
                ),
            );
        if (
            !target ||
            target.role !== "member" ||
            (target.active !== 1 && input.role !== "none")
        )
            throw new InboxError(
                "활성 일반 직원의 권한만 배정할 수 있습니다. 조직 관리자 권한은 조직 설정에서 변경해주세요.",
                403,
            );
        const [old] = await tx
            .select()
            .from(grants)
            .where(
                and(
                    eq(grants.workspaceId, workspaceId),
                    eq(grants.userId, input.userId),
                ),
            )
            .for("update");
        if ((old?.version ?? 0) !== input.version)
            throw new InboxError(
                "다른 관리자가 권한을 변경했습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.",
                409,
            );
        const beforeRole = old?.role ?? "none";
        if (beforeRole === input.role)
            return { role: beforeRole, version: input.version };
        const value = {
            orgId: actor.orgId,
            workspaceId,
            userId: input.userId,
            role: input.role,
            version: input.version + 1,
            updatedBy: actor.userId,
            updatedAt: new Date(),
        };
        await tx
            .insert(grants)
            .values(value)
            .onConflictDoUpdate({
                target: [grants.workspaceId, grants.userId],
                set: value,
            });
        await tx.insert(audit).values({
            orgId: actor.orgId,
            workspaceId,
            userId: input.userId,
            actorId: actor.userId,
            actorName: actor.name,
            beforeRole,
            afterRole: input.role,
            version: value.version,
        });
        return { role: input.role, version: value.version };
    });
}
