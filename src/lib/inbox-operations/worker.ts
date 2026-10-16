import { and, eq, isNull, lt, sql } from "drizzle-orm";
import {
    db,
    inboxResponseObligations as obligations,
    inboxServiceCases as cases,
    inboxOperationsSettings as settings,
    inboxConversations as chats,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { isOperationsInternal, notifyOperations } from "./enqueue";
import { operationsWorkerEnabled, notificationLabels } from "./rules";
type Options = { exec?: DbExec; now?: () => Date };
export async function processOperationsQueue(options: Options = {}) {
    const exec = options.exec ?? db,
        now = (options.now ?? (() => new Date()))(),
        due = [] as { caseId: string; obligationId?: string }[];
    const response = await exec
        .select({ caseId: cases.id, obligationId: obligations.id })
        .from(obligations)
        .innerJoin(cases, eq(cases.id, obligations.caseId))
        .innerJoin(settings, eq(settings.channelId, cases.channelId))
        .where(
            and(
                isNull(cases.closedAt),
                isNull(cases.pausedAt),
                isNull(obligations.respondedAt),
                isNull(obligations.breachedAt),
                lt(obligations.dueAt, now),
                sql`${settings.policy}->>'enabled'='true'`,
            ),
        )
        .orderBy(obligations.dueAt, obligations.id)
        .limit(20);
    due.push(...response);
    const resolution = await exec
        .select({ caseId: cases.id })
        .from(cases)
        .innerJoin(settings, eq(settings.channelId, cases.channelId))
        .where(
            and(
                isNull(cases.closedAt),
                isNull(cases.pausedAt),
                isNull(cases.resolutionBreachedAt),
                lt(cases.resolutionDueAt, now),
                sql`${settings.policy}->>'enabled'='true'`,
            ),
        )
        .orderBy(cases.resolutionDueAt, cases.id)
        .limit(20);
    due.push(...resolution);
    let processed = 0;
    for (const item of due)
        await exec.transaction(async (tx) => {
            const [hint] = await tx
                .select({ conversationId: cases.conversationId })
                .from(cases)
                .where(eq(cases.id, item.caseId));
            if (!hint) return;
            const [chat] = await tx
                .select()
                .from(chats)
                .where(eq(chats.id, hint.conversationId))
                .for("update");
            const [c] = await tx
                .select()
                .from(cases)
                .where(eq(cases.id, item.caseId))
                .for("update");
            const [setting] = await tx
                .select()
                .from(settings)
                .where(eq(settings.channelId, c.channelId))
                .for("share");
            if (
                !chat ||
                chat.historyOnly ||
                chat.mergedIntoId ||
                chat.id !== c.conversationId ||
                c.closedAt ||
                c.pausedAt ||
                !setting?.policy.enabled ||
                (await isOperationsInternal(tx, chat))
            )
                return;
            let kind = "sla_resolution",
                key = `sla-resolution:${c.id}`;
            if (item.obligationId) {
                const [o] = await tx
                    .select()
                    .from(obligations)
                    .where(
                        and(
                            eq(obligations.id, item.obligationId),
                            eq(obligations.caseId, c.id),
                        ),
                    )
                    .for("update");
                if (
                    !o ||
                    o.respondedAt ||
                    o.breachedAt ||
                    !o.dueAt ||
                    o.dueAt >= now
                )
                    return;
                kind = o.kind === "first" ? "sla_first" : "sla_next";
                key = `sla-response:${o.id}`;
                await tx
                    .update(obligations)
                    .set({ breachedAt: now })
                    .where(eq(obligations.id, o.id));
            } else {
                if (
                    c.resolutionBreachedAt ||
                    !c.resolutionDueAt ||
                    c.resolutionDueAt >= now
                )
                    return;
                await tx
                    .update(cases)
                    .set({ resolutionBreachedAt: now })
                    .where(eq(cases.id, c.id));
            }
            await notifyOperations(
                tx,
                chat,
                kind,
                key,
                notificationLabels[kind],
                now,
            );
            processed++;
        });
    return { processed };
}
const runtime = globalThis as typeof globalThis & {
    __sendbOperationsTimer?: ReturnType<typeof setTimeout>;
};
export function startOperationsScheduler() {
    if (!operationsWorkerEnabled() || runtime.__sendbOperationsTimer) return;
    const tick = async () => {
        try {
            await processOperationsQueue();
        } catch {
            console.error(
                "[inbox-operations] 응대 목표 검사 실패, 다음 회차에서 다시 확인",
            );
        } finally {
            runtime.__sendbOperationsTimer = setTimeout(
                () => void tick(),
                15000,
            );
            runtime.__sendbOperationsTimer.unref();
        }
    };
    runtime.__sendbOperationsTimer = setTimeout(() => void tick(), 15000);
    runtime.__sendbOperationsTimer.unref();
}
