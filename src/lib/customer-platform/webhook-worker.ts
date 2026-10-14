import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import {
    db,
    platformEvents,
    platformWebhooks as endpoints,
    platformWebhookDeliveries as deliveries,
    platformWebhookAttempts as attempts,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { openWebhookSecret } from "./webhook-crypto";
import { retryDelay } from "./webhook-rules";
import { sendWebhook, type WebhookTransport } from "./webhook-transport";
import { signSendbWebhook } from "../../../sdk/webhooks";
import { webhookWorkerEnabled } from "./webhook-repository";
const due = (now: Date) =>
    or(
        and(
            sql`${deliveries.state} IN ('pending','retry')`,
            lte(deliveries.availableAt, now),
        ),
        and(
            eq(deliveries.state, "processing"),
            lte(deliveries.leaseUntil, now),
        ),
    );
async function claim(exec: DbExec, now: Date) {
    return exec.transaction(async (tx) => {
        const [row] = await tx
            .select()
            .from(deliveries)
            .where(due(now))
            .orderBy(asc(deliveries.availableAt), asc(deliveries.id))
            .limit(1)
            .for("update", { skipLocked: true });
        if (!row) return null;
        await tx
            .update(attempts)
            .set({
                state: "unknown",
                error: "처리 중 연결이 종료되어 결과를 확인하지 못했습니다.",
                finishedAt: now,
            })
            .where(
                and(
                    eq(attempts.deliveryId, row.id),
                    eq(attempts.state, "sending"),
                ),
            );
        const [endpoint] = await tx
            .select()
            .from(endpoints)
            .where(eq(endpoints.id, row.endpointId));
        if (
            !endpoint.enabled ||
            endpoint.generation !== row.endpointVersion ||
            row.cycleAttempts >= 8
        ) {
            await tx
                .update(deliveries)
                .set({
                    state: row.cycleAttempts >= 8 ? "dead" : "cancelled",
                    leaseId: null,
                    leaseUntil: null,
                    lastError:
                        row.cycleAttempts >= 8
                            ? "자동 재시도 한도에 도달했습니다."
                            : "수신 설정 변경으로 발송 취소",
                })
                .where(eq(deliveries.id, row.id));
            return { skipped: true } as const;
        }
        const leaseId = randomUUID(),
            attempt = row.attempts + 1;
        const [delivery] = await tx
            .update(deliveries)
            .set({
                state: "processing",
                attempts: attempt,
                cycleAttempts: row.cycleAttempts + 1,
                leaseId,
                leaseUntil: new Date(now.getTime() + 60000),
            })
            .where(eq(deliveries.id, row.id))
            .returning();
        await tx.insert(attempts).values({
            deliveryId: row.id,
            attempt,
            leaseId,
            state: "sending",
            url: endpoint.url,
            startedAt: now,
        });
        const [event] = await tx
            .select()
            .from(platformEvents)
            .where(eq(platformEvents.id, row.eventId));
        return { skipped: false, delivery, endpoint, event } as const;
    });
}
export async function processWebhookDeliveries(
    options: {
        exec?: DbExec;
        send?: WebhookTransport;
        now?: () => Date;
        limit?: number;
    } = {},
) {
    const exec = options.exec ?? db,
        send = options.send ?? sendWebhook,
        clock = options.now ?? (() => new Date());
    let processed = 0;
    for (let i = 0; i < Math.min(20, Math.max(1, options.limit ?? 5)); i++) {
        const work = await claim(exec, clock());
        if (!work) break;
        if (work.skipped) continue;
        const { delivery, endpoint, event } = work;
        const [fresh] = await exec
            .select({
                enabled: endpoints.enabled,
                generation: endpoints.generation,
            })
            .from(endpoints)
            .where(eq(endpoints.id, endpoint.id));
        if (!fresh?.enabled || fresh.generation !== delivery.endpointVersion)
            continue;
        let status: number | null = null,
            error: string | null = null,
            retryAfter: string | null = null;
        try {
            const body = JSON.stringify(event.payload),
                timestamp = String(Math.floor(clock().getTime() / 1000)),
                secret = openWebhookSecret(
                    endpoint.secretCipher,
                    `${endpoint.orgId}:${endpoint.id}`,
                );
            const result = await send(endpoint.url, body, {
                "X-Sendb-Id": event.id,
                "X-Sendb-Timestamp": timestamp,
                "X-Sendb-Signature": signSendbWebhook(
                    body,
                    event.id,
                    timestamp,
                    secret,
                ),
                "X-Sendb-Delivery": delivery.id,
                "X-Sendb-Attempt": String(delivery.attempts),
            });
            status = result.status;
            retryAfter = result.retryAfter;
            if (status < 200 || status >= 300)
                error = `수신 서버 HTTP ${status}`;
        } catch {
            error = "수신 서버 연결·서명 처리에 실패했습니다.";
        }
        const now = clock(),
            success = status !== null && status >= 200 && status < 300,
            state = success
                ? "succeeded"
                : delivery.cycleAttempts >= 8
                  ? "dead"
                  : "retry";
        await exec.transaction(async (tx) => {
            const [owned] = await tx
                .select({ id: deliveries.id })
                .from(deliveries)
                .where(
                    and(
                        eq(deliveries.id, delivery.id),
                        eq(deliveries.leaseId, delivery.leaseId!),
                        eq(deliveries.state, "processing"),
                    ),
                )
                .for("update");
            // A late response may record its attempt, but cannot replace a newer lease/configuration's state.
            await tx
                .update(attempts)
                .set({
                    state: success ? "succeeded" : "failed",
                    status,
                    error,
                    finishedAt: now,
                })
                .where(
                    and(
                        eq(attempts.deliveryId, delivery.id),
                        eq(attempts.leaseId, delivery.leaseId!),
                        sql`${attempts.state} IN ('sending','unknown')`,
                    ),
                );
            if (owned)
                await tx
                    .update(deliveries)
                    .set({
                        state,
                        lastStatus: status,
                        lastError: error,
                        leaseId: null,
                        leaseUntil: null,
                        deliveredAt: success ? now : null,
                        availableAt: success
                            ? now
                            : new Date(
                                  now.getTime() +
                                      retryDelay(
                                          delivery.cycleAttempts,
                                          retryAfter,
                                          now,
                                      ),
                              ),
                    })
                    .where(eq(deliveries.id, delivery.id));
        });
        processed++;
    }
    return { processed };
}
const runtime = globalThis as typeof globalThis & {
    __sendbWebhookTimer?: ReturnType<typeof setTimeout>;
};
export function startWebhookScheduler() {
    if (!webhookWorkerEnabled() || runtime.__sendbWebhookTimer) return;
    const tick = async () => {
        try {
            await processWebhookDeliveries();
        } catch {
            console.error(
                "[customer-webhooks] 전달 처리 실패, 다음 회차에 재시도",
            );
        } finally {
            runtime.__sendbWebhookTimer = setTimeout(() => void tick(), 5000);
            runtime.__sendbWebhookTimer.unref();
        }
    };
    runtime.__sendbWebhookTimer = setTimeout(() => void tick(), 5000);
    runtime.__sendbWebhookTimer.unref();
}
