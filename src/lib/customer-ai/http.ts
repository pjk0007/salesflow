import { requireCustomerConversation } from "@/lib/customer-access/access";
import { NextRequest } from "next/server";
import { z } from "zod";
import { inboxActor } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import {
    authenticatePlatform,
    authorizeConversation,
} from "@/lib/customer-platform/external-auth";
import { webhookActor } from "@/lib/customer-platform/webhook-http";
export async function supportActor(
    req: NextRequest,
    external: boolean,
    scope: { workspaceId?: number; conversationId?: string },
    manage = false,
    create = false,
    permission?: "read" | "create" | "update",
) {
    if (scope.workspaceId)
        return webhookActor(
            req,
            external,
            { workspaceId: scope.workspaceId },
            manage,
            create,
        );
    const id = z.string().uuid().parse(scope.conversationId);
    if (external) {
        const ctx = await authenticatePlatform(req);
        await authorizeConversation(
            ctx,
            id,
            permission ?? (create ? "create" : "read"),
        );
        return ctx.actor;
    }
    const actor = inboxActor(req);
    await requireCustomerConversation(
        actor,
        id,
        (permission ?? (create ? "create" : "read")) === "read"
            ? "read"
            : "respond",
    );
    return actor;
}
export async function supportKnowledgeBody(req: NextRequest) {
    const reader = req.body?.getReader();
    if (!reader) throw new InboxError("지식 내용을 입력해주세요.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > 1024 * 1024) {
                await reader.cancel();
                throw new InboxError(
                    "지식 버전은 1MB까지 등록할 수 있습니다.",
                    413,
                );
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
