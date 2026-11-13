import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, inboxResponders as responders, organizationMembers, users } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { requireCustomerAccess, type CustomerActor } from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";

/** 이 사업의 상담 담당자 user id */
export async function listResponders(actor: CustomerActor, workspaceId: number) {
    await requireCustomerAccess(actor, workspaceId, "read");
    const rows = await db
        .select({ userId: responders.userId })
        .from(responders)
        .where(and(eq(responders.workspaceId, workspaceId), eq(responders.orgId, actor.orgId)));
    return rows.map((r) => r.userId);
}

/** 상담권한 켜기·끄기 — 사업 관리 권한 필요 */
export async function setResponder(actor: CustomerActor, workspaceId: number, raw: unknown) {
    await requireCustomerAccess(actor, workspaceId, "manage");
    const { userId, enabled } = z.object({ userId: z.string().uuid(), enabled: z.boolean() }).parse(raw);
    if (enabled) {
        const [member] = await db
            .select({ id: users.id })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(eq(organizationMembers.organizationId, actor.orgId), eq(users.id, userId), eq(users.isActive, 1)));
        if (!member) throw new InboxError("이 조직의 활성 직원을 선택해주세요.");
        await db.insert(responders).values({ orgId: actor.orgId, workspaceId, userId }).onConflictDoNothing();
    } else
        await db
            .delete(responders)
            .where(and(eq(responders.workspaceId, workspaceId), eq(responders.userId, userId), eq(responders.orgId, actor.orgId)));
    return { userId, enabled };
}

/** 이 사람이 이 사업의 상담 담당자인지 */
export async function isResponder(exec: DbExec, workspaceId: number, userId: string) {
    const [row] = await exec
        .select({ userId: responders.userId })
        .from(responders)
        .where(and(eq(responders.workspaceId, workspaceId), eq(responders.userId, userId)));
    return !!row;
}
