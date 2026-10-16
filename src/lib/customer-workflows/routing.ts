import { and, eq } from "drizzle-orm";
import { inboxTeams, inboxChannels, inboxTeamMembers, users } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
import { teamAssigneeCandidate } from "@/lib/inbox-routing/assignment";
import { teamAssignmentHours } from "@/lib/inbox-routing/hours";
import { assignmentHoursLabel } from "@/lib/inbox-routing/hours-label";
import type { LoadedWorkflowContext } from "./context";

export async function workflowTeam(
    orgId: string,
    workspaceId: number,
    teamId: string,
    exec: DbExec,
) {
    const [row] = await exec
        .select({ team: inboxTeams })
        .from(inboxTeams)
        .innerJoin(inboxChannels, eq(inboxChannels.id, inboxTeams.channelId))
        .where(
            and(
                eq(inboxTeams.id, teamId),
                eq(inboxTeams.orgId, orgId),
                eq(inboxChannels.orgId, orgId),
                eq(inboxChannels.workspaceId, workspaceId),
                eq(inboxChannels.enabled, true),
                eq(inboxTeams.enabled, true),
            ),
        );
    if (!row)
        throw new InboxError(
            "자동화에 사용할 이 사업의 활성 상담팀을 선택해주세요.",
            409,
        );
    return row.team;
}

export async function routingPersonName(id: string | null, exec: DbExec) {
    if (!id) return null;
    const [person] = await exec
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, id));
    return person?.name ?? null;
}

export async function previewWorkflowPerson(
    orgId: string,
    workspaceId: number,
    assigneeId: string | null,
    ctx: LoadedWorkflowContext,
    exec: DbExec,
) {
    const chat = ctx.conversation!;
    if (chat.teamId && assigneeId) {
        await workflowTeam(orgId, workspaceId, chat.teamId, exec);
        const [member] = await exec
            .select({ id: inboxTeamMembers.userId })
            .from(inboxTeamMembers)
            .where(
                and(
                    eq(inboxTeamMembers.teamId, chat.teamId),
                    eq(inboxTeamMembers.userId, assigneeId),
                ),
            );
        if (!member)
            throw new InboxError(
                "선택한 상담팀의 응대 가능한 팀원을 선택해주세요.",
                409,
            );
    }
    chat.assigneeId = assigneeId;
}

export async function previewWorkflowTeam(
    orgId: string,
    workspaceId: number,
    teamId: string,
    ctx: LoadedWorkflowContext,
    exec: DbExec,
) {
    const team = await workflowTeam(orgId, workspaceId, teamId, exec);
    const chat = ctx.conversation!;
    if (team.channelId !== chat.channelId)
        throw new InboxError(
            "상담과 같은 사업 상담창의 팀을 선택해주세요.",
            409,
        );
    if (chat.teamId === team.id)
        return `${team.name} · 같은 팀이므로 기존 담당을 유지합니다.`;
    chat.teamId = team.id;
    const hours = team.autoAssign
        ? await teamAssignmentHours(exec, team)
        : null;
    chat.assigneeId = await teamAssigneeCandidate(
        exec,
        team,
        undefined,
        chat.id,
    );
    const person = await routingPersonName(chat.assigneeId, exec);
    const waiting =
        hours?.open === false
            ? assignmentHoursLabel(hours)
            : "현재 조건에 맞는 배정 후보가 없어 팀 대기열 유지";
    return `${team.name} · ${team.autoAssign ? (person ? `자동 배정 예상: ${person}` : waiting) : "수동 배정 대기열"}. 처리 시점의 팀 설정·업무시간·권한·상담 수에 따라 결과가 달라질 수 있습니다.`;
}
