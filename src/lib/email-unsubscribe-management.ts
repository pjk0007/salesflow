import { db } from "@/lib/db";
import { getUserFromNextRequest } from "@/lib/auth";
import { recordUnsubscribe } from "@/lib/email-unsubscribe";
import { createUnsubscribeManagementHandlers } from "./email-unsubscribe-management-handlers";
import { createUnsubscribeManagementRepository } from "./email-unsubscribe-management-repository";

export const unsubscribeManagementHandlers = createUnsubscribeManagementHandlers({
    authenticate: getUserFromNextRequest,
    ...createUnsubscribeManagementRepository(db),
    async register(orgId, input) {
        await recordUnsubscribe({ orgId, workspaceId: null, email: input.email, reason: input.reason || null, source: "manual" });
    },
});
