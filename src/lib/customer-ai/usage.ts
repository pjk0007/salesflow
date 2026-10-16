import { and, eq, sql } from "drizzle-orm";
import {
    customerAiCalls as calls,
    customerAiJobs as jobs,
    aiUsageQuotas,
    aiUsageLogs,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { CopyProviderResponse } from "@/lib/ai-copy/provider";
export async function recordSupportUsage(
    exec: DbExec,
    id: string,
    response: CopyProviderResponse,
    late = false,
) {
    await exec.transaction(async (tx) => {
        const [call] = await tx
            .select()
            .from(calls)
            .where(eq(calls.id, id))
            .for("update");
        if (!call) return;
        const [job] = await tx
            .select({ orgId: jobs.orgId, requestedBy: jobs.requestedBy })
            .from(jobs)
            .where(eq(jobs.id, call.jobId));
        if (!job) return;
        const prompt =
                response.promptTokens === null
                    ? call.promptTokens
                    : Math.max(call.promptTokens ?? 0, response.promptTokens),
            completion =
                response.completionTokens === null
                    ? call.completionTokens
                    : Math.max(
                          call.completionTokens ?? 0,
                          response.completionTokens,
                      ),
            delta =
                Math.max(0, (prompt ?? 0) - call.chargedPrompt) +
                Math.max(0, (completion ?? 0) - call.chargedCompletion);
        if (delta > 0) {
            const month = call.startedAt.toISOString().slice(0, 7);
            await tx
                .insert(aiUsageQuotas)
                .values({ orgId: job.orgId, month, totalTokens: delta })
                .onConflictDoUpdate({
                    target: [aiUsageQuotas.orgId, aiUsageQuotas.month],
                    set: {
                        totalTokens: sql`${aiUsageQuotas.totalTokens}+${delta}`,
                        updatedAt: new Date(),
                    },
                });
        }
        let usageLogId = call.usageLogId;
        if (prompt !== null || completion !== null) {
            if (usageLogId)
                await tx
                    .update(aiUsageLogs)
                    .set({
                        promptTokens: prompt ?? 0,
                        completionTokens: completion ?? 0,
                    })
                    .where(
                        and(
                            eq(aiUsageLogs.id, usageLogId),
                            eq(aiUsageLogs.orgId, job.orgId),
                        ),
                    );
            else {
                const [log] = await tx
                    .insert(aiUsageLogs)
                    .values({
                        orgId: job.orgId,
                        userId: job.requestedBy,
                        provider: call.provider,
                        model: call.model,
                        promptTokens: prompt ?? 0,
                        completionTokens: completion ?? 0,
                        purpose: "customer_support",
                    })
                    .returning({ id: aiUsageLogs.id });
                usageLogId = log.id;
            }
        }
        await tx
            .update(calls)
            .set({
                state: late ? "late" : "completed",
                promptTokens: prompt,
                completionTokens: completion,
                chargedPrompt: Math.max(call.chargedPrompt, prompt ?? 0),
                chargedCompletion: Math.max(
                    call.chargedCompletion,
                    completion ?? 0,
                ),
                usageLogId,
                finishedAt: new Date(),
            })
            .where(eq(calls.id, id));
    });
}
