import { NextRequest } from "next/server";
import { z } from "zod";
import { ownedActor } from "@/lib/customer-imports/routes";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { readFileUpload } from "@/lib/inbox/file-http";
import { fileAction } from "./rules";
import {
    importFilePage,
    prepareImportFiles,
    refreshImportFileSource,
    transferImportFile,
    archiveImportTarget,
    connectArchivedImportObject,
} from "./repository";
type Context = { params: Promise<{ id: string }> };
export function importFileHandlers(external: boolean) {
    return {
        GET: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const id = z
                        .string()
                        .uuid()
                        .parse((await c.params).id),
                    actor = await ownedActor(req, external, id, "read"),
                    offset = z.coerce
                        .number()
                        .int()
                        .min(0)
                        .parse(req.nextUrl.searchParams.get("offset") ?? 0);
                return importFilePage(actor, id, offset);
            }),
        POST: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const jobId = z
                        .string()
                        .uuid()
                        .parse((await c.params).id),
                    actor = await ownedActor(req, external, jobId, "update");
                if (
                    req.headers
                        .get("content-type")
                        ?.startsWith("multipart/form-data")
                ) {
                    const { form, ...file } = await readFileUpload(req),
                        id = z.string().uuid().parse(form.get("id")),
                        version = z.coerce
                            .number()
                            .int()
                            .positive()
                            .parse(form.get("version"));
                    return transferImportFile(actor, jobId, id, version, file);
                }
                const input = fileAction.parse(await jsonBody(req));
                if (input.action === "archive_plan" || input.action === "archive_attach")
                    return (input.action === "archive_plan" ? archiveImportTarget : connectArchivedImportObject)(
                        actor, jobId, input.id, input.version, { size: input.size, sha256: input.sha256 },
                    );
                if (input.action === "prepare")
                    return prepareImportFiles(actor, jobId, input.offset);
                if (input.action === "source")
                    return refreshImportFileSource(
                        actor,
                        jobId,
                        input.id,
                        input.version,
                        input.url,
                    );
                return transferImportFile(
                    actor,
                    jobId,
                    input.id,
                    input.version,
                );
            }),
    };
}
