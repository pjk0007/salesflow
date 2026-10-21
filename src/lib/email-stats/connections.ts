import { queryClient } from "../db";
import { isReplyScopeOrg } from "../email-reply-list";
import { journeyAlertConfig } from "../customer-journey-alert-config";

export async function statsConnections(orgId: string, workspaceId: number | null) {
    const [reply, sites, spaces] = await Promise.all([
        isReplyScopeOrg(orgId),
        queryClient<{
            found: boolean;
        }[]> `SELECT EXISTS(SELECT 1 FROM tracker_sites WHERE org_id=${orgId} AND is_active=1 AND (${workspaceId}::int IS
            NULL OR workspace_id=${workspaceId})) AS found`,
        queryClient<{
            id: number;
        }[]> `SELECT id FROM workspaces WHERE org_id=${orgId} AND (${workspaceId}::int IS NULL OR id=${workspaceId})`,
    ]);
    const config = journeyAlertConfig(process.env);
    return {
        reply,
        site: sites[0].found,
        journey: config.mode !== "off" && spaces.some((space) => config.ids.includes(space.id))
    };
}
