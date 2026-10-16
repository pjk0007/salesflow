"use client";
import useSWR from "swr";
import { loadTeams, saveRoutingTeam } from "../api";
export function useInboxTeams(channelId: number) {
    const query = useSWR(
        `/api/inbox-routing/teams?channelId=${channelId}`,
        loadTeams,
        { refreshInterval: 15000 },
    );
    async function save(input: Parameters<typeof saveRoutingTeam>[1]) {
        const team = await saveRoutingTeam(channelId, input);
        await query.mutate();
        return team;
    }
    return { ...query, save };
}
