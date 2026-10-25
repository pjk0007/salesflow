import { sql } from "drizzle-orm";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { InboxError } from "@/lib/inbox/errors";
import type { ImportScope } from "./storage";
import type { ImportJob } from "./repository";
import type { ImportPlanRow } from "./rules";
import { applyImportRow, type ImportMessageBatch } from "./writer";

/** 묶음 안에서 실패한 행을 알려 준다(실패 사유와 감사 기록에 행 번호·종류·원본 ID를 남긴다). */
export class ImportRowError extends Error {
    constructor(
        public row: Pick<ImportPlanRow, "index" | "kind" | "sourceId">,
        public cause: unknown,
    ) {
        super(cause instanceof Error ? cause.message : "import row failed");
        this.name = "ImportRowError";
    }
}
async function applyRow(...args: Parameters<typeof applyImportRow>) {
    try {
        return await applyImportRow(...args);
    } catch (error) {
        const row = args[3];
        throw new ImportRowError(
            { index: row.index, kind: row.kind, sourceId: row.sourceId },
            error,
        );
    }
}

const independentCreate = (row: ImportPlanRow) =>
    row.kind === "messages" && row.operation === "create" && row.targetId === null;

/** Parents, edits and reuse stay ordered. Only independent new messages may pipeline. */
export async function applyImportBatch(
    actor: SalesActor,
    scope: ImportScope,
    job: ImportJob,
    rows: ImportPlanRow[],
    tx: DbExec,
    messageBatch: ImportMessageBatch,
    pipeline = false,
) {
    for (let at = 0; at < rows.length;) {
        let end = at;
        if (pipeline) while (end < rows.length && independentCreate(rows[end])) end++;
        if (end - at < 2) {
            await applyRow(actor, scope, job, rows[at++], tx, messageBatch);
            continue;
        }
        const group = rows.slice(at, end);
        // Reserve increasing IDs in plan order so timestamp ties keep their original order.
        // Sequence gaps on rollback are normal; no existing message ID is reused.
        const allocated = await tx.execute(sql`
            select nextval(pg_get_serial_sequence('inbox_messages', 'id'))::integer as id
            from generate_series(1, ${group.length}) order by id
        `);
        const ids = allocated.map(row => Number(row.id));
        if (ids.length !== group.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 1))
            throw new InboxError("이전 메시지 식별자 묶음을 확인하지 못했습니다.");
        let next = 0, failed = false, firstError: unknown;
        async function worker() {
            while (!failed && next < group.length) {
                const index = next++;
                try {
                    await applyRow(actor, scope, job, group[index], tx, messageBatch, ids[index]);
                } catch (error) {
                    if (!failed) firstError = error;
                    failed = true;
                }
            }
        }
        // Await every in-flight query before allowing the transaction to roll back.
        await Promise.all(Array.from({ length: Math.min(8, group.length) }, worker));
        if (failed) throw firstError;
        at = end;
    }
}
