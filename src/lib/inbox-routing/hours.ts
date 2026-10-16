import { and, eq } from "drizzle-orm";
import { inboxOperationsSettings, inboxTeams } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { businessAvailability } from "@/lib/inbox-operations/calendar";

export async function channelAssignmentHours(
    exec: DbExec,
    orgId: string,
    channelId: number,
    now = new Date(),
) {
    const [saved] = await exec
        .select({ policy: inboxOperationsSettings.policy })
        .from(inboxOperationsSettings)
        .where(
            and(
                eq(inboxOperationsSettings.channelId, channelId),
                eq(inboxOperationsSettings.orgId, orgId),
            ),
        );
    if (!saved)
        return {
            configured: false,
            open: false,
            timezone: null,
            nextOpenAt: null,
        };
    return {
        configured: true,
        timezone: saved.policy.calendar.timezone,
        ...businessAvailability(saved.policy.calendar, now),
    };
}

export async function teamAssignmentHours(
    exec: DbExec,
    team: Pick<
        typeof inboxTeams.$inferSelect,
        "orgId" | "channelId" | "requireBusinessHours"
    >,
    now = new Date(),
) {
    return team.requireBusinessHours
        ? channelAssignmentHours(exec, team.orgId, team.channelId, now)
        : null;
}
