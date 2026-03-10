import { db, aiUsageLogs, aiUsageQuotas, subscriptions, plans } from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";

async function getQuotaLimitForOrg(orgId: string): Promise<number> {
    const [sub] = await db
        .select({ planId: subscriptions.planId })
        .from(subscriptions)
        .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.status, "active")))
        .limit(1);

    if (!sub?.planId) return 100_000;

    const [plan] = await db
        .select({ name: plans.name })
        .from(plans)
        .where(eq(plans.id, sub.planId))
        .limit(1);

    if (plan?.name === "Enterprise") return 100_000_000;
    if (plan?.name === "Pro") return 10_000_000;
    return 1_000_000;
}

async function getOrCreateQuota(orgId: string, month: string): Promise<{ totalTokens: number; quotaLimit: number }> {
    const [existing] = await db
        .select({ totalTokens: aiUsageQuotas.totalTokens, quotaLimit: aiUsageQuotas.quotaLimit })
        .from(aiUsageQuotas)
        .where(and(eq(aiUsageQuotas.orgId, orgId), eq(aiUsageQuotas.month, month)))
        .limit(1);

    if (existing) {
        const currentLimit = await getQuotaLimitForOrg(orgId);
        if (existing.quotaLimit !== currentLimit) {
            await db.update(aiUsageQuotas)
                .set({ quotaLimit: currentLimit, updatedAt: new Date() })
                .where(and(eq(aiUsageQuotas.orgId, orgId), eq(aiUsageQuotas.month, month)));
            return { ...existing, quotaLimit: currentLimit };
        }
        return existing;
    }

    const limit = await getQuotaLimitForOrg(orgId);
    const [created] = await db
        .insert(aiUsageQuotas)
        .values({ orgId, month, totalTokens: 0, quotaLimit: limit })
        .onConflictDoNothing()
        .returning({ totalTokens: aiUsageQuotas.totalTokens, quotaLimit: aiUsageQuotas.quotaLimit });

    return created ?? { totalTokens: 0, quotaLimit: limit };
}

export async function checkTokenQuota(orgId: string): Promise<{ allowed: boolean; remaining: number }> {
    const month = new Date().toISOString().slice(0, 7);
    const quota = await getOrCreateQuota(orgId, month);
    const remaining = quota.quotaLimit - quota.totalTokens;
    return { allowed: remaining > 0, remaining };
}

export async function updateTokenUsage(orgId: string, tokens: number): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);

    const [existing] = await db
        .select({ id: aiUsageQuotas.id })
        .from(aiUsageQuotas)
        .where(and(eq(aiUsageQuotas.orgId, orgId), eq(aiUsageQuotas.month, month)))
        .limit(1);

    if (existing) {
        await db
            .update(aiUsageQuotas)
            .set({
                totalTokens: sql`${aiUsageQuotas.totalTokens} + ${tokens}`,
                updatedAt: new Date(),
            })
            .where(eq(aiUsageQuotas.id, existing.id));
    } else {
        const limit = await getQuotaLimitForOrg(orgId);
        await db
            .insert(aiUsageQuotas)
            .values({ orgId, month, totalTokens: tokens, quotaLimit: limit })
            .onConflictDoNothing();
    }
}

export async function getUsageData(orgId: string) {
    const month = new Date().toISOString().slice(0, 7);
    const quota = await getOrCreateQuota(orgId, month);

    const breakdown = await db
        .select({
            purpose: aiUsageLogs.purpose,
            totalPrompt: sql<number>`COALESCE(SUM(${aiUsageLogs.promptTokens}), 0)`,
            totalCompletion: sql<number>`COALESCE(SUM(${aiUsageLogs.completionTokens}), 0)`,
            count: sql<number>`COUNT(*)`,
        })
        .from(aiUsageLogs)
        .where(and(
            eq(aiUsageLogs.orgId, orgId),
            gte(aiUsageLogs.createdAt, new Date(`${month}-01`)),
        ))
        .groupBy(aiUsageLogs.purpose);

    return {
        month,
        totalTokens: quota.totalTokens,
        quotaLimit: quota.quotaLimit,
        remaining: quota.quotaLimit - quota.totalTokens,
        usagePercent: quota.quotaLimit > 0 ? Math.round((quota.totalTokens / quota.quotaLimit) * 100) : 0,
        breakdown: breakdown.map((b) => ({
            purpose: b.purpose,
            tokens: Number(b.totalPrompt) + Number(b.totalCompletion),
        })),
    };
}

export async function logAiUsage(params: {
    orgId: string;
    userId: string | null;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    purpose: string;
}) {
    await db.insert(aiUsageLogs).values(params);
}
