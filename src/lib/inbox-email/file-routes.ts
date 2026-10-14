import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody, inboxActor } from "@/lib/inbox/http";
import { attachmentGet, readUpload } from "@/lib/inbox/file-http";
import {
    authenticatePlatform,
    authorizeWorkspace,
} from "@/lib/customer-platform/external-auth";
import { InboxError } from "@/lib/inbox/errors";
import {
    ownedEmailReceipt,
    listEmailReceiptFiles,
    ownedEmailFile,
    storeEmailFile,
    failEmailFile,
    emailDeliveryFileScope,
} from "./files";
import { emailDeliveryMailbox, ownedMailbox } from "./repository";
import { pendingEmailFiles, retryEmailFile } from "./files";
type Context = { params: Promise<{ id: string; fileId?: string }> };
export async function pendingFilesGet(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id),
            box = await ownedMailbox(ctx.actor, id);
        await authorizeWorkspace(ctx, box.workspaceId, "read");
        return pendingEmailFiles(
            ctx.actor,
            id,
            req.nextUrl.searchParams.has("before")
                ? z
                      .string()
                      .uuid()
                      .parse(req.nextUrl.searchParams.get("before"))
                : undefined,
        );
    });
}
export async function retryFilePost(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const actor = inboxActor(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id);
        z.object({ action: z.literal("retry") })
            .strict()
            .parse(await jsonBody(req));
        return retryEmailFile(actor, id);
    });
}
export async function receiptFilesGet(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id),
            { box } = await ownedEmailReceipt(ctx.actor, id);
        await authorizeWorkspace(ctx, box.workspaceId, "read");
        return listEmailReceiptFiles(ctx.actor, id);
    });
}
export async function emailFilePost(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id),
            hint = await ownedEmailFile(ctx.actor, id);
        await authorizeWorkspace(ctx, hint.box.workspaceId, "read");
        if (
            req.headers.get("content-type")?.startsWith("multipart/form-data")
        ) {
            await authorizeWorkspace(ctx, hint.box.workspaceId, "create");
            const raw = await readUpload(req);
            if (raw.kind !== "customer" || raw.clientId !== id)
                throw new InboxError("수신 첨부 번호를 확인해주세요.");
            return storeEmailFile(ctx.actor, id, raw.bytes);
        }
        await authorizeWorkspace(ctx, hint.box.workspaceId, "update");
        const input = z
            .object({
                action: z.literal("failed"),
                errorCode: z.enum([
                    "download_failed",
                    "source_missing",
                    "size_mismatch",
                ]),
            })
            .strict()
            .parse(await jsonBody(req));
        return failEmailFile(ctx.actor, id, input.errorCode);
    });
}
export async function deliveryFileGet(req: NextRequest, c: Context) {
    return attachmentGet(
        async () => {
            const ctx = await authenticatePlatform(req),
                params = await c.params,
                id = z.string().uuid().parse(params.id),
                fileId = z.string().uuid().parse(params.fileId),
                box = await emailDeliveryMailbox(ctx.actor, id);
            await authorizeWorkspace(ctx, box.workspaceId, "read");
            await authorizeWorkspace(ctx, box.workspaceId, "update");
            return emailDeliveryFileScope(
                ctx.actor,
                id,
                fileId,
                z.string().uuid().parse(req.headers.get("x-sendb-email-lease")),
            );
        },
        async () =>
            z
                .string()
                .uuid()
                .parse((await c.params).fileId),
    );
}
