import { and, asc, eq, sql } from "drizzle-orm";
import { inboxTeams, inboxTeamMembers as members } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { customerAccessPredicate } from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";
import { agentAvailablePredicate } from "@/lib/inbox-presence/repository";
import {
    openWorkload,
    hasCapacity,
    claimCapacity,
} from "@/lib/inbox-capacity/limits";
export const teamMemberPredicate = (
    teamId: string,
    userId: string | ReturnType<typeof sql>,
) =>
    sql`EXISTS (SELECT 1 FROM inbox_team_members itm JOIN inbox_teams it ON it.id=itm.team_id
        WHERE itm.team_id=${teamId}::uuid AND itm.user_id=${userId}::uuid AND it.enabled=true)`;
export async function assignmentTeam(
    exec: DbExec,
    orgId: string,
    channelId: number,
    teamId: string,
    required = true,
) {
    const [team] = await exec
        .select()
        .from(inboxTeams)
        .where(
            and(
                eq(inboxTeams.id, teamId),
                eq(inboxTeams.channelId, channelId),
                eq(inboxTeams.orgId, orgId),
                eq(inboxTeams.enabled, true),
            ),
        )
        .for("update");
    if (!team && required)
        throw new InboxError("이 사업의 사용 중인 상담팀을 선택해주세요.", 409);
    return team ?? null;
}
export async function teamAssigneeCandidate(
    exec: DbExec,
    team: typeof inboxTeams.$inferSelect,
    onlyUserId?: string,
    excludeConversationId?: string,
) {
    return (
        (
            await teamAssigneeCandidates(
                exec,
                team,
                onlyUserId,
                excludeConversationId,
            )
        )[0]?.userId ?? null
    );
}
async function teamAssigneeCandidates(
    exec: DbExec,
    team: typeof inboxTeams.$inferSelect,
    onlyUserId?: string,
    excludeConversationId?: string,
) {
    if (!team.autoAssign) return [];
    const next = await exec
        .select({
            userId: members.userId,
            workload: openWorkload(
                team.channelId,
                members.userId,
                excludeConversationId,
            ),
        })
        .from(members)
        .where(
            and(
                eq(members.teamId, team.id),
                onlyUserId ? eq(members.userId, onlyUserId) : undefined,
                hasCapacity(
                    team.channelId,
                    members.userId,
                    excludeConversationId,
                ),
                team.requireAvailable
                    ? agentAvailablePredicate(team.channelId, members.userId)
                    : undefined,
                customerAccessPredicate(
                    team.orgId,
                    members.userId,
                    sql`(SELECT workspace_id FROM inbox_channels WHERE id=${team.channelId})`,
                    "respond",
                ),
            ),
        )
        .orderBy(
            sql`2 ASC`,
            sql`${members.lastAssignedAt} ASC NULLS FIRST`,
            asc(members.userId),
        )
        .limit(100);
    return next;
}
export async function chooseTeamAssignee(
    exec: DbExec,
    team: typeof inboxTeams.$inferSelect,
    excludeConversationId?: string,
) {
    const candidates = await teamAssigneeCandidates(
        exec,
        team,
        undefined,
        excludeConversationId,
    );
    if (!candidates) return null;
    for (const candidate of candidates) {
        const userId = candidate.userId;
        if (
            !(await claimCapacity(
                exec,
                team.channelId,
                userId,
                excludeConversationId,
            ))
        )
            continue;
        if (
            !(await teamAssigneeCandidate(
                exec,
                team,
                userId,
                excludeConversationId,
            ))
        )
            continue;
        await exec
            .update(members)
            .set({ lastAssignedAt: new Date() })
            .where(
                and(eq(members.teamId, team.id), eq(members.userId, userId)),
            );
        return userId;
    }
    return null;
}
