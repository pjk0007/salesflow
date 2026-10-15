import { inboxRequest, inboxWrite } from "@/components/inbox/api";
import type { RoutingTeam } from "../types";
export const loadTeams = (url: string) => inboxRequest<RoutingTeam[]>(url);
export function saveRoutingTeam(
    channelId: number,
    input: {
        id?: string;
        version?: number;
        name: string;
        description: string;
        enabled: boolean;
        autoAssign: boolean;
        memberIds: string[];
    },
) {
    const { id, version, ...value } = input;
    return id
        ? inboxWrite<RoutingTeam>(
              `/api/inbox-routing/teams/${id}`,
              { ...value, version },
              "PATCH",
          )
        : inboxWrite<RoutingTeam>("/api/inbox-routing/teams", {
              ...value,
              channelId,
          });
}
