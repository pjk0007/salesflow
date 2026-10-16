import { NextRequest } from "next/server";
import { z } from "zod";
import { attachmentGet } from "@/lib/inbox/file-http";
import { staffDownloadScope } from "@/lib/inbox/repository";
import {
    authenticatePlatform,
    authorizeChannel,
} from "@/lib/customer-platform/external-auth";
export async function GET(
    req: NextRequest,
    c: { params: Promise<{ id: string }> },
) {
    const id = () => c.params.then((p) => z.string().uuid().parse(p.id));
    return attachmentGet(async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        const ctx = await authenticatePlatform(req);
        const scope = await staffDownloadScope(ctx.actor, id);
        await authorizeChannel(ctx, scope.channelId, "read");
        return scope;
    }, id);
}
