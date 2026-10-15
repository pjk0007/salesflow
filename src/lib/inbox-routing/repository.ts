import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
    db,
    inboxTeams,
    inboxTeamMembers,
    inboxChannels,
    users,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    customerAccessPredicate,
    customerStaffActor,
    requireCustomerAccess,
    requireCustomerChannel,
    type CustomerActor,
} from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";
import { appendInboxAudit, type AuditChanges } from "@/lib/inbox/audit";
import { createTeamInput, patchTeamInput } from "./rules";
const columns = {
    id: inboxTeams.id,
    channelId: inboxTeams.channelId,
    name: inboxTeams.name,
    description: inboxTeams.description,
    autoAssign: inboxTeams.autoAssign,
    requireAvailable: inboxTeams.requireAvailable,
    enabled: inboxTeams.enabled,
    version: inboxTeams.version,
};
async function rows(channelIds: number[], exec: DbExec) {
    if (!channelIds.length) return [];
    const teams = await exec
        .select(columns)
        .from(inboxTeams)
        .where(inArray(inboxTeams.channelId, channelIds))
        .orderBy(inboxTeams.name);
    const members = teams.length
        ? await exec
              .select({
                  teamId: inboxTeamMembers.teamId,
                  userId: inboxTeamMembers.userId,
                  name: users.name,
                  eligible: sql<boolean>`${customerAccessPredicate(inboxTeams.orgId, users.id, inboxChannels.workspaceId, "respond")}`,
              })
              .from(inboxTeamMembers)
              .innerJoin(users, eq(users.id, inboxTeamMembers.userId))
              .innerJoin(inboxTeams, eq(inboxTeams.id, inboxTeamMembers.teamId))
              .innerJoin(
                  inboxChannels,
                  eq(inboxChannels.id, inboxTeams.channelId),
              )
              .where(
                  inArray(
                      inboxTeamMembers.teamId,
                      teams.map((t) => t.id),
                  ),
              )
        : [];
    return teams.map((t) => ({
        ...t,
        memberIds: members
            .filter((m) => m.teamId === t.id)
            .map((m) => m.userId)
            .sort(),
        members: members
            .filter((m) => m.teamId === t.id)
            .map((m) => ({ id: m.userId, name: m.name, eligible: m.eligible })),
    }));
}
export async function visibleTeams(actor: CustomerActor, exec: DbExec = db) {
    const channels = await exec
        .select({ id: inboxChannels.id })
        .from(inboxChannels)
        .where(
            and(
                eq(inboxChannels.orgId, actor.orgId),
                customerAccessPredicate(
                    actor.orgId,
                    actor.userId,
                    inboxChannels.workspaceId,
                ),
            ),
        );
    return rows(
        channels.map((c) => c.id),
        exec,
    );
}
export async function listTeams(
    actor: CustomerActor,
    channelId: number,
    exec: DbExec = db,
) {
    await requireCustomerChannel(actor, channelId, "read", exec);
    return rows([channelId], exec);
}
export async function readTeam(
    actor: CustomerActor,
    id: string,
    exec: DbExec = db,
) {
    const [team] = await exec
        .select({ channelId: inboxTeams.channelId })
        .from(inboxTeams)
        .where(and(eq(inboxTeams.id, id), eq(inboxTeams.orgId, actor.orgId)));
    if (!team) throw new InboxError("상담팀을 찾을 수 없습니다.", 404);
    return (await listTeams(actor, team.channelId, exec)).find(
        (t) => t.id === id,
    )!;
}
async function membersAllowed(
    actor: CustomerActor,
    workspaceId: number,
    ids: string[],
    exec: DbExec,
) {
    for (const id of ids)
        await requireCustomerAccess(
            await customerStaffActor(actor.orgId, id, "팀원", exec),
            workspaceId,
            "respond",
            exec,
        );
}
async function membershipLabels(ids: string[], exec: DbExec) {
    if (!ids.length) return "팀원 없음";
    const names = await exec
        .select({ name: users.name })
        .from(users)
        .where(inArray(users.id, ids));
    return (
        names
            .map((n) => n.name)
            .sort()
            .join(", ") || "팀원 없음"
    );
}
export async function saveTeam(
    actor: CustomerActor,
    id: string | null,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = id
        ? patchTeamInput.parse(raw, {
              error: () => "팀 설정 입력값을 확인해주세요.",
          })
        : createTeamInput.parse(raw, {
              error: () => "팀 설정 입력값을 확인해주세요.",
          });
    return exec.transaction(async (tx) => {
        const [existing] = id
            ? await tx
                  .select()
                  .from(inboxTeams)
                  .where(
                      and(
                          eq(inboxTeams.id, id),
                          eq(inboxTeams.orgId, actor.orgId),
                      ),
                  )
            : [];
        if (id && !existing)
            throw new InboxError("상담팀을 찾을 수 없습니다.", 404);
        const channelId =
            existing?.channelId ??
            (input as ReturnType<typeof createTeamInput.parse>).channelId;
        const channel = await requireCustomerChannel(
            actor,
            channelId,
            "manage",
            tx,
        );
        await tx.execute(sql`SELECT pg_advisory_xact_lock(106,${channelId})`);
        const [current] = id
            ? await tx
                  .select()
                  .from(inboxTeams)
                  .where(eq(inboxTeams.id, id))
                  .for("update")
            : [];
        if (
            current &&
            (!("version" in input) || input.version !== current.version)
        )
            throw new InboxError(
                "다른 사람이 팀 설정을 변경했습니다. 최신 정보를 불러와주세요.",
                409,
            );
        const oldMembers = current
            ? (
                  await tx
                      .select()
                      .from(inboxTeamMembers)
                      .where(eq(inboxTeamMembers.teamId, current.id))
              )
                  .map((m) => m.userId)
                  .sort()
            : [];
        const memberIds = [...(input.memberIds ?? oldMembers)].sort();
        if (input.memberIds)
            await membersAllowed(
                actor,
                channel.workspaceId,
                memberIds.filter((userId) => !oldMembers.includes(userId)),
                tx,
            );
        const value = {
            name: input.name ?? current!.name,
            description: input.description ?? current!.description,
            autoAssign: input.autoAssign ?? current!.autoAssign,
            requireAvailable:
                input.requireAvailable ?? current!.requireAvailable,
            enabled: input.enabled ?? current!.enabled,
        };
        const [duplicate] = await tx
            .select({ id: inboxTeams.id })
            .from(inboxTeams)
            .where(
                and(
                    eq(inboxTeams.channelId, channelId),
                    sql`lower(${inboxTeams.name})=lower(${value.name})`,
                    id ? ne(inboxTeams.id, id) : undefined,
                ),
            );
        if (duplicate)
            throw new InboxError(
                "같은 이름의 상담팀이 있습니다. 기존 팀을 확인해주세요.",
                409,
            );
        const changes: AuditChanges = {};
        for (const k of Object.keys(value) as (keyof typeof value)[])
            if (!current || current[k] !== value[k])
                changes[k] = { before: current?.[k] ?? null, after: value[k] };
        if (JSON.stringify(oldMembers) !== JSON.stringify(memberIds))
            changes.memberIds = {
                before: oldMembers,
                after: memberIds,
                beforeLabel: await membershipLabels(oldMembers, tx),
                afterLabel: await membershipLabels(memberIds, tx),
            };
        if (current && !Object.keys(changes).length)
            return (await rows([channelId], tx)).find(
                (t) => t.id === current.id,
            )!;
        const [saved] = current
            ? await tx
                  .update(inboxTeams)
                  .set({ ...value, version: current.version + 1 })
                  .where(eq(inboxTeams.id, current.id))
                  .returning()
            : await tx
                  .insert(inboxTeams)
                  .values({ ...value, channelId, orgId: actor.orgId })
                  .returning();
        const removed = oldMembers.filter(
            (userId) => !memberIds.includes(userId),
        );
        if (removed.length)
            await tx
                .delete(inboxTeamMembers)
                .where(
                    and(
                        eq(inboxTeamMembers.teamId, saved.id),
                        inArray(inboxTeamMembers.userId, removed),
                    ),
                );
        const added = memberIds.filter(
            (userId) => !oldMembers.includes(userId),
        );
        if (added.length)
            await tx
                .insert(inboxTeamMembers)
                .values(added.map((userId) => ({ teamId: saved.id, userId })));
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId,
            conversationId: null,
            actorId: actor.userId,
            actorName: actor.name,
            action: "team.updated",
            changes: {
                ...changes,
                team: { before: current?.name ?? null, after: saved.name },
            },
        });
        return (await rows([channelId], tx)).find((t) => t.id === saved.id)!;
    });
}
