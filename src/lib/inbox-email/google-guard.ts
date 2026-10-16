import { eq } from "drizzle-orm";
import { inboxGoogleConnections as connections } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
// Caller holds the mailbox lock before mutating. OAuth changes take the same lock.
export async function checkGoogleGuard(
    exec: DbExec,
    mailboxId: string,
    version?: number,
) {
    if (version === undefined) return;
    const [connection] = await exec
        .select({ version: connections.version, status: connections.status })
        .from(connections)
        .where(eq(connections.mailboxId, mailboxId));
    if (
        !connection ||
        connection.version !== version ||
        connection.status !== "connected"
    )
        throw new InboxError("메일 계정 연결이 변경되었습니다.", 409);
}
