import { NextRequest } from "next/server";
import { z } from "zod";
import { attachmentPost } from "@/lib/inbox/file-http";
import { staffFileScope } from "@/lib/inbox/repository";
import { inboxActor } from "@/lib/inbox/http";
export async function POST(
    req: NextRequest,
    c: { params: Promise<{ id: string }> },
) {
    return attachmentPost(req, async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        return staffFileScope(inboxActor(req), id);
    });
}
