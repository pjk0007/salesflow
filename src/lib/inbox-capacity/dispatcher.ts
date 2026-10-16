import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
    db,
    inboxConversations as chats,
    inboxTeams as teams,
    inboxChannels,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    customerStaffActor,
    requireCustomerChannel,
    customerAccessPredicate,
    type CustomerActor,
} from "@/lib/customer-access/access";
import { patchConversation } from "@/lib/inbox/repository";
import { InboxError } from "@/lib/inbox/errors";
import { capacityWorkerEnabled } from "./rules";

export async function dispatchChannel(
    actor: CustomerActor,
    channelId: number,
    exec: DbExec = db,
) {
    await requireCustomerChannel(actor, channelId, "manage", exec);
    const ids = await exec
        .select({ id: chats.id })
        .from(chats)
        .innerJoin(teams, eq(teams.id, chats.teamId))
        .where(
            and(
                eq(chats.channelId, channelId),
                eq(chats.orgId, actor.orgId),
                eq(chats.status, "open"),
                eq(chats.historyOnly, false),
                isNull(chats.mergedIntoId),
                isNull(chats.assigneeId),
                eq(teams.enabled, true),
                eq(teams.autoAssign, true),
            ),
        )
        .orderBy(
            sql`${chats.routingAttemptAt} ASC NULLS FIRST`,
            asc(chats.createdAt),
            asc(chats.id),
        )
        .limit(50);
    let assigned = 0,
        waiting = 0;
    for (const hint of ids)
        await exec.transaction(async (tx) => {
            const [chat] = await tx
                .select()
                .from(chats)
                .where(
                    and(
                        eq(chats.id, hint.id),
                        eq(chats.channelId, channelId),
                        isNull(chats.assigneeId),
                        eq(chats.status, "open"),
                        isNull(chats.mergedIntoId),
                    ),
                )
                .for("update", { skipLocked: true });
            if (!chat?.teamId) return;
            const [team] = await tx
                .select()
                .from(teams)
                .where(
                    and(
                        eq(teams.id, chat.teamId),
                        eq(teams.channelId, channelId),
                        eq(teams.enabled, true),
                        eq(teams.autoAssign, true),
                    ),
                )
                .for("update");
            if (!team) return;
            await tx
                .update(chats)
                .set({ routingAttemptAt: new Date() })
                .where(eq(chats.id, chat.id));
            const { chooseTeamAssignee } = await import(
                "@/lib/inbox-routing/assignment"
            );
            const person = await chooseTeamAssignee(tx, team, chat.id);
            if (!person) {
                waiting++;
                return;
            }
            await patchConversation(
                actor,
                chat.id,
                { version: chat.version, assigneeId: person },
                tx,
            );
            assigned++;
        });
    return { examined: ids.length, assigned, waiting };
}
export async function processRoutingQueue(exec: DbExec = db) {
    // Use a current business manager; a timer never invents staff authority.
    const channels = await exec
        .select({
            channel: inboxChannels,
            managerId: sql<
                string | null
            >`(SELECT u.id FROM users u WHERE ${customerAccessPredicate(sql`${inboxChannels}.org_id`, sql`u.id`, sql`${inboxChannels}.workspace_id`, "manage")} ORDER BY u.id LIMIT 1)`,
        })
        .from(inboxChannels)
        .where(eq(inboxChannels.enabled, true));
    let assigned = 0;
    for (const c of channels) {
        if (!c.managerId) continue;
        try {
            const actor = await customerStaffActor(
                c.channel.orgId,
                c.managerId,
                "자동 배정",
                exec,
            );
            assigned += (await dispatchChannel(actor, c.channel.id, exec))
                .assigned;
        } catch (error) {
            if (
                !(error instanceof InboxError) ||
                ![401, 403, 404].includes(error.status)
            )
                throw error;
        }
    }
    return { assigned };
}
const runtime = globalThis as typeof globalThis & {
    __sendbRoutingTimer?: ReturnType<typeof setTimeout>;
};
export function startRoutingScheduler() {
    if (!capacityWorkerEnabled() || runtime.__sendbRoutingTimer) return;
    const tick = async () => {
        try {
            await processRoutingQueue();
        } catch {
            console.error(
                "[inbox-routing] 대기 상담 배정 실패, 다음 회차에서 다시 확인",
            );
        } finally {
            runtime.__sendbRoutingTimer = setTimeout(() => void tick(), 15000);
            runtime.__sendbRoutingTimer.unref();
        }
    };
    runtime.__sendbRoutingTimer = setTimeout(() => void tick(), 15000);
    runtime.__sendbRoutingTimer.unref();
}
