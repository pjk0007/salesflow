import { NextRequest } from "next/server";
import { z } from "zod";
import { attachmentPost } from "@/lib/inbox/file-http";
import { staffFileScope } from "@/lib/inbox/repository";
import {
    authenticatePlatform,
    authorizeConversation,
} from "@/lib/customer-platform/external-auth";
export async function POST(
    req: NextRequest,
    c: { params: Promise<{ id: string }> },
) {
    return attachmentPost(req, async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        const ctx = await authenticatePlatform(req);
        await authorizeConversation(ctx, id, "create");
        return staffFileScope(ctx.actor, id);
    });
}
