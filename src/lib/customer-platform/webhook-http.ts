import { requireCustomerAccess } from "@/lib/customer-access/access";
import { NextRequest } from "next/server";
import { inboxActor } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import { authenticatePlatform, authorizeWorkspace } from "./external-auth";
import { ownedWebhook, ownedDelivery } from "./webhook-repository";
export async function webhookActor(
    req: NextRequest,
    external: boolean,
    scope: { workspaceId?: number; endpointId?: string; deliveryId?: string },
    manage = false,
    create = false,
) {
    const ctx = external ? await authenticatePlatform(req) : null;
    const actor = ctx?.actor ?? inboxActor(req);
    const workspaceId =
        scope.workspaceId ??
        (scope.endpointId
            ? (await ownedWebhook(actor, scope.endpointId)).workspaceId
            : scope.deliveryId
              ? (await ownedDelivery(actor, scope.deliveryId)).workspaceId
              : undefined);
    if (ctx && workspaceId)
        await authorizeWorkspace(
            ctx,
            workspaceId,
            manage ? (create ? "create" : "update") : "read",
        );
    if (!workspaceId) throw new InboxError("사업을 선택해주세요.");
    await requireCustomerAccess(actor, workspaceId, manage ? "manage" : "read");
    return actor;
}
