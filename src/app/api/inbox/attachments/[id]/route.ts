import { NextRequest } from "next/server";
import { z } from "zod";
import { attachmentGet } from "@/lib/inbox/file-http";
import { staffDownloadScope } from "@/lib/inbox/repository";
import { inboxActor } from "@/lib/inbox/http";
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
        return staffDownloadScope(inboxActor(req), id);
    }, id);
}
