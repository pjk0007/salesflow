import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, emailPreparedSends, emailSenderDailyPlans, emailSenderDailyUsage, emailSenderProfiles, emailSendLogs } from "./db";
import type { PreparedEmailPayload, PreparedSend } from "./db";
import { kstParts, kstToDate } from "./kst";
import { capForDate, isSendableNow } from "./email-sender-limit-rules";
import type { SlotDeferReason } from "./email-sender-limit-rules";
import { pickSenderCandidates } from "./email-sender-limit-paths";
import { toOrgSenderProfile } from "./email-sender-resolver";
import type { LegacyEmailConfig, OrgSenderProfile } from "./email-sender-resolver";
import { DELIVERY_GRACE_MS, nextPreparationAt, nextRandomDailySlot, PREPARATION_LEAD_MS } from "./email-random-schedule-rules";
import { acceptedOrPendingCondition } from "./email-send-log-status";

const PLAN_LOCK = 0x5c4edf12;
const RECIPIENT_LOCK = 0x5c4edf13;

export type PreparationReservation =
    | { kind: "legacy"; ids?: number[] }
    | { kind: "sent" | "uncertain" }
    | { kind: "deferred"; retryAt: Date; reason: SlotDeferReason }
    | { kind: "reserved"; row: PreparedSend; sender: OrgSenderProfile };

export async function loadPreparedSend(queueId: number, linkId: number): Promise<PreparedSend | undefined> {
    const [row] = await db.select().from(emailPreparedSends).where(and(
        eq(emailPreparedSends.queueId, queueId), eq(emailPreparedSends.linkId, linkId),
    ));
    return row;
}

/** 실제 사용량과 아직 발송 전인 예약을 함께 세고, 조직 단위 트랜잭션 잠금으로 중복 배정을 막는다. */
export async function reservePreparedSend(input: {
    queueId: number; linkId: number; orgId: string; ids: number[];
    config: LegacyEmailConfig | null; sourceHash: string; now?: Date; forceReplan?: boolean;
}, database: Pick<typeof db, "transaction"> = db): Promise<PreparationReservation> {
    const now = input.now ?? new Date();
    const today = kstParts(now).date;
    return database.transaction(async (tx): Promise<PreparationReservation> => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAN_LOCK}, hashtext(${input.orgId}))`);
        const [existing] = await tx.select().from(emailPreparedSends).where(and(
            eq(emailPreparedSends.queueId, input.queueId), eq(emailPreparedSends.linkId, input.linkId),
        ));
        if (existing?.status === "sending" || existing?.status === "uncertain") return { kind: "uncertain" };
        const sameSource = existing?.sourceHash === input.sourceHash;
        if (existing?.status === "sent" && sameSource) return { kind: "sent" };

        const profiles = (await tx.select().from(emailSenderProfiles)
            .where(eq(emailSenderProfiles.orgId, input.orgId)).orderBy(emailSenderProfiles.id)).map(toOrgSenderProfile);
        const picked = pickSenderCandidates(profiles, { mode: "pool", ids: input.ids, config: input.config });
        // 하루 할당량이 없는 기존 설정은 기존 경로를 쓴다. 임의의 발송 한도를 새로 만들지 않는다.
        if (!Array.isArray(picked)) {
            if (existing && existing.status !== "sent") await tx.update(emailPreparedSends)
                .set({ status: "cancelled", updatedAt: now }).where(eq(emailPreparedSends.id, existing.id));
            return { kind: "legacy" };
        }
        const unlimited = picked.filter((p) => p.limits.dailyLimit === null && !p.limits.warmupEnabled);
        const candidates = picked.filter((p) => !unlimited.includes(p)).map((p) => ({ ...p, limits: {
            ...p.limits, sendWindowStart: p.limits.sendWindowStart ?? 9, sendWindowEnd: p.limits.sendWindowEnd ?? 18,
        } }));
        const current = candidates.find((p) => p.id === existing?.senderProfileId);
        const cap = current ? capForDate(current.limits, today) : 0;
        const validReservation = !input.forceReplan && existing && sameSource && current && !current.limits.isPaused &&
            existing.status !== "cancelled" && existing.usageDate === today && cap !== null &&
            existing.ordinal < cap && isSendableNow(current.limits, existing.scheduledAt) &&
            (existing.scheduledAt.getTime() > now.getTime() || isSendableNow(current.limits, now)) &&
            existing.scheduledAt.getTime() >= now.getTime() - DELIVERY_GRACE_MS;
        if (validReservation) return { kind: "reserved", row: existing, sender: current };

        // 오래된 예약·바뀐 원본은 자리를 다시 배정한다. 본문은 원본이 같을 때만 재사용한다.
        if (existing) await tx.update(emailPreparedSends).set({ status: "cancelled", updatedAt: now })
            .where(eq(emailPreparedSends.id, existing.id));
        const ids = candidates.map((p) => p.id);
        const plans = ids.length ? await tx.select().from(emailSenderDailyPlans).where(and(
            inArray(emailSenderDailyPlans.senderProfileId, ids), eq(emailSenderDailyPlans.usageDate, today),
        )) : [];
        const missingPlans = candidates.filter((p) => !plans.some((plan) => plan.senderProfileId === p.id) &&
            (capForDate(p.limits, today) ?? 0) > 0 && now.getTime() + PREPARATION_LEAD_MS < kstToDate(today, p.limits.sendWindowEnd ?? 18).getTime());
        if (missingPlans.length) plans.push(...await tx.insert(emailSenderDailyPlans).values(missingPlans.map((p) => ({
            senderProfileId: p.id, usageDate: today,
            startAt: new Date(Math.max(kstToDate(today, p.limits.sendWindowStart ?? 9).getTime(), now.getTime() + PREPARATION_LEAD_MS)),
        }))).onConflictDoNothing().returning());
        const usage = ids.length ? await tx.select().from(emailSenderDailyUsage).where(and(
            inArray(emailSenderDailyUsage.senderProfileId, ids), eq(emailSenderDailyUsage.usageDate, today),
        )) : [];
        const reservations = ids.length ? await tx.select({
            senderProfileId: emailPreparedSends.senderProfileId, ordinal: emailPreparedSends.ordinal, status: emailPreparedSends.status,
        }).from(emailPreparedSends).where(and(
            inArray(emailPreparedSends.senderProfileId, ids), eq(emailPreparedSends.usageDate, today),
            ne(emailPreparedSends.status, "cancelled"),
        )) : [];
        const available = candidates.flatMap((sender) => {
            const dailyCap = capForDate(sender.limits, today) ?? 0;
            const allocated = reservations.filter((r) => r.senderProfileId === sender.id);
            const sent = usage.find((u) => u.senderProfileId === sender.id)?.sentCount ?? 0;
            const pending = allocated.filter((r) => r.status === "reserved" || r.status === "ready").length;
            if (sent + pending >= dailyCap) return [];
            const occupied = new Set(allocated.map((r) => r.ordinal));
            const plan = plans.find((p) => p.senderProfileId === sender.id);
            const slot = plan ? nextRandomDailySlot(sender.id, sender.limits, today, plan.startAt,
                new Date(now.getTime() + PREPARATION_LEAD_MS), occupied) : null;
            return slot ? [{ sender, ...slot, load: (sent + pending) / dailyCap }] : [];
        }).sort((a, b) => a.load - b.load || a.scheduledAt.getTime() - b.scheduledAt.getTime());
        const next = available[0];
        if (!next) {
            if (unlimited.length) return { kind: "legacy", ids: unlimited.map((p) => p.id) };
            const retryAt = candidates.map((p) => nextPreparationAt(p.limits, now))
                .sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
            return { kind: "deferred", retryAt, reason: candidates.every((p) => p.limits.isPaused) ? "paused" : "daily_limit" };
        }
        const payload = sameSource ? existing?.payload ?? null : null;
        const values = {
            queueId: input.queueId, linkId: input.linkId, orgId: input.orgId,
            senderProfileId: next.sender.id, usageDate: today, ordinal: next.ordinal,
            scheduledAt: next.scheduledAt, sourceHash: input.sourceHash, payload,
            status: payload ? "ready" : "reserved", logId: null, updatedAt: now,
        };
        const [row] = await tx.insert(emailPreparedSends).values(values).onConflictDoUpdate({
            target: [emailPreparedSends.queueId, emailPreparedSends.linkId], set: values,
        }).returning();
        return { kind: "reserved", row, sender: next.sender };
    });
}

export async function savePreparedContent(id: number, payload: PreparedEmailPayload) {
    await db.update(emailPreparedSends).set({ payload, status: "ready", updatedAt: new Date() })
        .where(and(eq(emailPreparedSends.id, id), inArray(emailPreparedSends.status, ["reserved", "ready"])));
}

export async function cancelPreparedSend(queueId: number, linkId: number) {
    await db.update(emailPreparedSends).set({ status: "cancelled", updatedAt: new Date() }).where(and(
        eq(emailPreparedSends.queueId, queueId), eq(emailPreparedSends.linkId, linkId),
        inArray(emailPreparedSends.status, ["reserved", "ready"]),
    ));
}

/** 선점과 로그 생성을 함께 커밋한다. 전송 결과가 불명확한 건은 자동 재전송하지 않는다. */
type DeliveryStart = { logId: number } | { skip: "duplicate_recipient" | "delivery_uncertain" };
export async function beginPreparedDelivery(id: number, log: typeof emailSendLogs.$inferInsert, preventDuplicate: boolean): Promise<DeliveryStart> {
    return db.transaction(async (tx): Promise<DeliveryStart> => {
        if (preventDuplicate) {
            const key = `${log.orgId}:${log.partitionId}:${log.recipientEmail}`;
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${RECIPIENT_LOCK}, hashtext(${key}))`);
            const [duplicate] = await tx.select({ id: emailSendLogs.id }).from(emailSendLogs).where(and(
                eq(emailSendLogs.orgId, log.orgId), eq(emailSendLogs.partitionId, log.partitionId!),
                eq(emailSendLogs.recipientEmail, log.recipientEmail), eq(emailSendLogs.triggerType, "ai_auto"),
                await acceptedOrPendingCondition(),
            )).limit(1);
            if (duplicate) return { skip: "duplicate_recipient" };
        }
        const [claimed] = await tx.update(emailPreparedSends).set({ status: "sending", updatedAt: new Date() })
            .where(and(eq(emailPreparedSends.id, id), eq(emailPreparedSends.status, "ready"))).returning({ id: emailPreparedSends.id });
        if (!claimed) return { skip: "delivery_uncertain" };
        const [inserted] = await tx.insert(emailSendLogs).values(log).returning({ id: emailSendLogs.id });
        await tx.update(emailPreparedSends).set({ logId: inserted.id }).where(eq(emailPreparedSends.id, id));
        return { logId: inserted.id };
    });
}

export async function finishPreparedDelivery(id: number, status: "sent" | "ready" | "uncertain") {
    await db.update(emailPreparedSends).set({ status, updatedAt: new Date() }).where(eq(emailPreparedSends.id, id));
}
