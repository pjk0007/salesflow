import { and, eq } from "drizzle-orm";
import { db, inboxAgentAvailability as settings, users } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    requireCustomerChannel,
    requireCustomerAccess,
    customerStaffActor,
    type CustomerActor,
} from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";
import { appendInboxAudit } from "@/lib/inbox/audit";
import { presencePage } from "@/lib/inbox-presence/repository";
import { capacityInput, capacityWorkerEnabled } from "./rules";
import { lockCapacitySettings } from "./limits";
export async function capacityPage(
    actor: CustomerActor,
    channelId: number,
    exec: DbExec = db,
) {
    await requireCustomerChannel(actor, channelId, "manage", exec);
    const presence = await presencePage(actor, channelId, null, exec),
        configs = await exec
            .select()
            .from(settings)
            .where(eq(settings.channelId, channelId));
    return {
        agents: presence.agents
            .filter((a) => a.canRespond)
            .map((a) => ({
                ...a,
                version: configs.find((c) => c.userId === a.id)?.version ?? 0,
            })),
        workerEnabled: capacityWorkerEnabled(),
    };
}
export async function setCapacity(
    actor: CustomerActor,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = capacityInput.parse(raw, {
        error: () => "자동 배정 한도를 0~1,000 또는 무제한으로 입력해주세요.",
    });
    const channel = await requireCustomerChannel(
        actor,
        input.channelId,
        "manage",
        exec,
    );
    const target = await customerStaffActor(
        actor.orgId,
        input.userId,
        "직원",
        exec,
    );
    await requireCustomerAccess(target, channel.workspaceId, "respond", exec);
    const [targetUser] = await exec
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, target.userId));
    if (!targetUser) throw new InboxError("직원을 찾을 수 없습니다.", 404);
    return exec.transaction(async (tx) => {
        await lockCapacitySettings(tx, input.channelId, input.userId);
        const where = and(
            eq(settings.channelId, input.channelId),
            eq(settings.userId, input.userId),
        );
        const [current] = await tx
            .select()
            .from(settings)
            .where(where)
            .for("update");
        if ((current?.version ?? 0) !== input.version)
            throw new InboxError(
                "응대 상태 또는 한도가 다른 창에서 바뀌었습니다. 작성한 값은 보존하고 최신 설정을 불러와주세요.",
                409,
            );
        if (
            (current?.maxOpenConversations ?? null) ===
            input.maxOpenConversations
        )
            return {
                version: current?.version ?? 0,
                maxOpenConversations: input.maxOpenConversations,
            };
        const value = {
            maxOpenConversations: input.maxOpenConversations,
            version: input.version + 1,
            updatedAt: new Date(),
        };
        const [saved] = current
            ? await tx.update(settings).set(value).where(where).returning()
            : await tx
                  .insert(settings)
                  .values({
                      ...value,
                      channelId: input.channelId,
                      userId: input.userId,
                      state: "away",
                  })
                  .onConflictDoNothing()
                  .returning();
        if (!saved)
            throw new InboxError(
                "다른 창에서 한도가 바뀌었습니다. 최신 설정을 확인해주세요.",
                409,
            );
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: channel.id,
            actorId: actor.userId,
            actorName: actor.name,
            action: "capacity.updated",
            changes: {
                capacity: {
                    before: current?.maxOpenConversations ?? null,
                    after: input.maxOpenConversations,
                    beforeLabel:
                        current?.maxOpenConversations == null
                            ? "무제한"
                            : `${current.maxOpenConversations}건`,
                    afterLabel:
                        input.maxOpenConversations === null
                            ? "무제한"
                            : `${input.maxOpenConversations}건`,
                },
                capacityAgent: {
                    before: target.userId,
                    after: target.userId,
                    beforeLabel: targetUser.name,
                    afterLabel: targetUser.name,
                },
            },
        });
        return {
            version: saved.version,
            maxOpenConversations: saved.maxOpenConversations,
        };
    });
}
