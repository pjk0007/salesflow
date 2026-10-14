import type { JWTPayload } from "@/types";
import type { DbExec } from "@/lib/db/tx";
import { downloadAttachment } from "@/lib/inbox/files";
import {
    listMailboxes,
    receiveEmail,
    claimEmail,
    changeEmailDelivery,
} from "./repository";
import {
    pendingEmailFiles,
    listEmailReceiptFiles,
    storeEmailFile,
    failEmailFile,
    emailDeliveryFileScope,
} from "./files";
import type { EmailTransportClient } from "./gmail";
const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
// Same repository and DTO contract as the private API, without loopback HTTP or stored API keys.
export function googleTransport(
    actor: Pick<JWTPayload, "orgId" | "userId" | "name" | "role">,
    version: number,
    exec: DbExec,
    now: () => Date,
): EmailTransportClient {
    return {
        emailMailboxes: async (workspaceId) =>
            wire(await listMailboxes(actor, workspaceId, exec)),
        receiveEmail: async (id, input) =>
            wire(await receiveEmail(actor, id, input, exec, version)),
        claimEmail: async (id) =>
            wire(await claimEmail(actor, id, exec, now(), version)),
        changeEmailDelivery: async (id, input) =>
            wire(
                await changeEmailDelivery(
                    actor,
                    id,
                    input,
                    exec,
                    now(),
                    version,
                ),
            ),
        emailReceiptFiles: async (id) =>
            wire(await listEmailReceiptFiles(actor, id, exec)),
        pendingEmailFiles: async (id, before) =>
            wire(await pendingEmailFiles(actor, id, before, exec)),
        uploadEmailFile: async (id, file) =>
            wire(
                await storeEmailFile(
                    actor,
                    id,
                    Buffer.from(await file.arrayBuffer()),
                    exec,
                    version,
                ),
            ),
        failEmailFile: async (id, code) =>
            wire(await failEmailFile(actor, id, code, exec, version)),
        downloadEmailDeliveryFile: async (id, fileId, lease) => {
            const scope = await emailDeliveryFileScope(
                    actor,
                    id,
                    fileId,
                    lease,
                    exec,
                    now(),
                    version,
                ),
                file = await downloadAttachment(scope, fileId, exec);
            return {
                ...file,
                disposition: null,
                bytes: Uint8Array.from(file.bytes).buffer,
            };
        },
    };
}
