import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "./http";
import { InboxError } from "./errors";
import {
    uploadAttachment,
    cancelAttachment,
    downloadAttachmentStream,
    MAX_FILE_BYTES,
    type FileScope,
} from "./files";

export async function readFileUpload(req: NextRequest) {
    const max = MAX_FILE_BYTES + 65536;
    if (Number(req.headers.get("content-length")) > max)
        throw new InboxError("첨부 파일은 20MB까지 보낼 수 있습니다.", 413);
    const reader = req.body?.getReader();
    if (!reader) throw new InboxError("파일을 선택해주세요.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > max) {
                await reader.cancel();
                throw new InboxError(
                    "첨부 파일은 20MB까지 보낼 수 있습니다.",
                    413,
                );
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    let form: FormData;
    try {
        form = await new Response(Buffer.concat(chunks), {
            headers: { "content-type": req.headers.get("content-type") ?? "" },
        }).formData();
    } catch {
        throw new InboxError("파일 전송 형식을 확인해주세요.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1)
        throw new InboxError("파일을 하나씩 첨부해주세요.");
    return {
        form,
        fileName: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
    };
}
export async function readUpload(req: NextRequest) {
    const { form, ...file } = await readFileUpload(req);
    return {
        ...file,
        clientId: z.string().uuid().parse(form.get("clientId")),
        kind: z.enum(["customer", "reply", "note"]).parse(form.get("kind")),
    };
}
export async function attachmentPost(
    req: NextRequest,
    scope: () => Promise<FileScope>,
) {
    return handleInbox(async () => {
        const owner = await scope();
        if (req.headers.get("content-type")?.startsWith("multipart/form-data"))
            return uploadAttachment(owner, await readUpload(req));
        const body = z
            .object({ action: z.literal("cancel"), id: z.string().uuid() })
            .parse(await jsonBody(req));
        return cancelAttachment(owner, body.id);
    });
}
export async function attachmentGet(
    scope: () => Promise<FileScope>,
    id: () => Promise<string>,
) {
    try {
        const file = await downloadAttachmentStream(await scope(), await id());
        return new NextResponse(file.body, {
            headers: {
                "Content-Type": file.contentType,
                "Content-Length": String(file.size),
                "Content-Disposition": `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
            },
        });
    } catch (error) {
        return handleInbox(async () => {
            throw error;
        });
    }
}
