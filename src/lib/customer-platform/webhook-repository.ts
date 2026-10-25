import { requireCustomerAccess } from "@/lib/customer-access/access";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    workspaces,
    platformWebhooks as endpoints,
    platformWebhookDeliveries as deliveries,
    platformWebhookAttempts as attempts,
    platformWebhookAudit as audit,
    platformEvents,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "./sales-repository";
import { InboxError } from "@/lib/inbox/errors";
import {
    webhookCreate,
    webhookPatch,
    webhookEventTypes,
} from "./webhook-rules";
import {
    newWebhookSecret,
    sealWebhookSecret,
    secretHint,
} from "./webhook-crypto";
import { enqueuePlatformEvent } from "./outbox";
export function endpointDto(row: typeof endpoints.$inferSelect) {
    const { secretCipher: _, ...dto } = row;
    void _;
    return dto;
}
export async function ownedWebhook(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
    lock = false,
) {
    z.string().uuid().parse(id);
    const query = exec
        .select()
        .from(endpoints)
        .where(and(eq(endpoints.id, id), eq(endpoints.orgId, actor.orgId)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new InboxError("웹훅을 찾을 수 없습니다.", 404);
    await requireCustomerAccess(actor, row.workspaceId, "read", exec);
    return row;
}
export function webhookWorkerEnabled() {
    return (
        process.env.NODE_ENV === "production" &&
        process.env.CUSTOMER_WEBHOOK_WORKER === "on"
    );
}
export async function listWebhooks(
    actor: SalesActor,
    workspaceId: number,
    exec: DbExec = db,
) {
    await requireCustomerAccess(actor, workspaceId, "read", exec);
    const rows = await exec
        .select()
        .from(endpoints)
        .where(
            and(
                eq(endpoints.orgId, actor.orgId),
                eq(endpoints.workspaceId, workspaceId),
            ),
        )
        .orderBy(desc(endpoints.createdAt), desc(endpoints.id));
    return {
        endpoints: rows.map(endpointDto),
        eventTypes: webhookEventTypes,
        workerEnabled: webhookWorkerEnabled(),
    };
}
export async function createWebhook(
    actor: SalesActor,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = webhookCreate.parse(raw);
    await requireCustomerAccess(actor, input.workspaceId, "manage", exec);
    return exec.transaction(async (tx) => {
        await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, input.workspaceId))
            .for("update");
        const count = await tx
            .select({ id: endpoints.id })
            .from(endpoints)
            .where(
                and(
                    eq(endpoints.orgId, actor.orgId),
                    eq(endpoints.workspaceId, input.workspaceId),
                ),
            )
            .limit(20);
        if (count.length >= 20)
            throw new InboxError(
                "사업마다 웹훅은 20개까지 등록할 수 있습니다.",
                409,
            );
        const id = randomUUID(),
            secret = newWebhookSecret();
        const [created] = await tx
            .insert(endpoints)
            .values({
                ...input,
                id,
                orgId: actor.orgId,
                enabled: false,
                secretCipher: sealWebhookSecret(secret, `${actor.orgId}:${id}`),
                secretHint: secretHint(secret),
            })
            .returning();
        await tx.insert(audit).values({
            endpointId: id,
            actorName: actor.name,
            action: "created",
            version: 1,
        });
        return { endpoint: endpointDto(created), secret };
    });
}
export async function updateWebhook(
    actor: SalesActor,
    id: string,
    raw: unknown,
    rotate = false,
    exec: DbExec = db,
) {
    const { version, ...input } = webhookPatch.parse(raw);
    return exec.transaction(async (tx) => {
        const current = await ownedWebhook(actor, id, tx, true);
        await requireCustomerAccess(actor, current.workspaceId, "manage", tx);
        if (current.version !== version)
            throw new InboxError(
                "웹훅 설정이 변경되었습니다. 최신 설정을 불러온 뒤 다시 저장해주세요.",
                409,
            );
        const next = { ...current, ...input },
            changed =
                rotate ||
                ["name", "url", "eventTypes", "enabled"].some(
                    (k) =>
                        JSON.stringify(current[k as keyof typeof current]) !==
                        JSON.stringify(next[k as keyof typeof next]),
                );
        if (!changed) return { endpoint: endpointDto(current) };
        const deliveryChanged =
            rotate ||
            ["url", "eventTypes", "enabled"].some(
                (k) =>
                    JSON.stringify(current[k as keyof typeof current]) !==
                    JSON.stringify(next[k as keyof typeof next]),
            );
        const secret = rotate ? newWebhookSecret() : undefined;
        const [saved] = await tx
            .update(endpoints)
            .set({
                ...input,
                version: version + 1,
                generation: current.generation + (deliveryChanged ? 1 : 0),
                updatedAt: new Date(),
                ...(secret
                    ? {
                          secretCipher: sealWebhookSecret(
                              secret,
                              `${actor.orgId}:${id}`,
                          ),
                          secretHint: secretHint(secret),
                      }
                    : {}),
            })
            .where(eq(endpoints.id, id))
            .returning();
        if (deliveryChanged) {
            const cancelled = await tx
                .update(deliveries)
                .set({
                    state: "cancelled",
                    leaseId: null,
                    leaseUntil: null,
                    lastError: "수신 설정 변경으로 이전 대기 발송 취소",
                })
                .where(
                    and(
                        eq(deliveries.endpointId, id),
                        sql`${deliveries.state} IN ('pending','retry','processing')`,
                    ),
                )
                .returning({ id: deliveries.id });
            if (cancelled.length)
                await tx
                    .update(attempts)
                    .set({
                        state: "unknown",
                        error: "전송 설정 변경 중 결과 미확인",
                        finishedAt: new Date(),
                    })
                    .where(
                        and(
                            sql`${attempts.deliveryId} in (${sql.join(
                                cancelled.map((d) => sql`${d.id}`),
                                sql`,`,
                            )})`,
                            eq(attempts.state, "sending"),
                        ),
                    );
        }
        await tx.insert(audit).values({
            endpointId: id,
            actorName: actor.name,
            action: rotate ? "secret.rotated" : "settings.updated",
            version: saved.version,
        });
        return { endpoint: endpointDto(saved), ...(secret ? { secret } : {}) };
    });
}
export async function webhookDetail(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
) {
    const endpoint = await ownedWebhook(actor, id, exec),
        history = await exec
            .select()
            .from(audit)
            .where(eq(audit.endpointId, id))
            .orderBy(desc(audit.createdAt), desc(audit.id))
            .limit(100);
    return { endpoint: endpointDto(endpoint), history };
}
export async function testWebhook(
    actor: SalesActor,
    id: string,
    clientId: string,
    exec: DbExec = db,
) {
    z.string().uuid().parse(clientId);
    return exec.transaction(async (tx) => {
        const endpoint = await ownedWebhook(actor, id, tx, true);
        await requireCustomerAccess(actor, endpoint.workspaceId, "manage", tx);
        await requireCustomerAccess(actor, endpoint.workspaceId, "manage", tx);
        if (!endpoint.enabled)
            throw new InboxError(
                "수신 서버에 서명 키를 설정한 뒤 웹훅을 켜주세요.",
                409,
            );
        await enqueuePlatformEvent(tx, {
            orgId: actor.orgId,
            workspaceId: endpoint.workspaceId,
            key: `webhook-test:${id}:${clientId}`,
            type: "platform.test",
            data: { test: true, message: "샌드비 가상 연동 확인" },
            endpointId: id,
        });
        return { queued: true };
    });
}
export async function webhookDeliveryPage(
    actor: SalesActor,
    id: string,
    before?: string,
    state?: string,
    exec: DbExec = db,
) {
    await ownedWebhook(actor, id, exec);
    const base = and(
        eq(deliveries.endpointId, id),
        eq(deliveries.orgId, actor.orgId),
        state
            ? eq(
                  deliveries.state,
                  z
                      .enum([
                          "pending",
                          "processing",
                          "retry",
                          "succeeded",
                          "dead",
                          "cancelled",
                      ])
                      .parse(state),
              )
            : undefined,
    );
    let cursor;
    if (before) {
        z.string().uuid().parse(before);
        [cursor] = await exec
            .select()
            .from(deliveries)
            .where(and(base, eq(deliveries.id, before)));
        if (!cursor)
            throw new InboxError("전달 이력 위치를 찾을 수 없습니다.", 404);
    }
    const rows = await exec
        .select({ delivery: deliveries, type: platformEvents.type })
        .from(deliveries)
        .innerJoin(platformEvents, eq(platformEvents.id, deliveries.eventId))
        .where(
            and(
                base,
                cursor
                    ? or(
                          lt(deliveries.createdAt, cursor.createdAt),
                          and(
                              eq(deliveries.createdAt, cursor.createdAt),
                              lt(deliveries.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
        .limit(100);
    return {
        rows: rows.map((r) => ({ ...r.delivery, type: r.type })),
        hasMore: rows.length === 100,
    };
}
export async function ownedDelivery(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
    lock = false,
) {
    z.string().uuid().parse(id);
    const query = exec
        .select()
        .from(deliveries)
        .where(and(eq(deliveries.id, id), eq(deliveries.orgId, actor.orgId)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new InboxError("전달 이력을 찾을 수 없습니다.", 404);
    await requireCustomerAccess(actor, row.workspaceId, "read", exec);
    return row;
}
export async function webhookDeliveryDetail(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
) {
    const delivery = await ownedDelivery(actor, id, exec),
        [event] = await exec
            .select()
            .from(platformEvents)
            .where(eq(platformEvents.id, delivery.eventId)),
        history = await exec
            .select()
            .from(attempts)
            .where(eq(attempts.deliveryId, id))
            .orderBy(desc(attempts.attempt))
            .limit(100);
    return { delivery, payload: event.payload, attempts: history };
}
/** 한 번에 다시 보낼 수 있는 실패 전달 수(UX-098). */
export const BULK_RETRY_LIMIT = 100;
/**
 * 같은 웹훅의 실패·재시도 대기·취소 전달을 오래된 순으로 최대 100건 다시 대기열에 넣는다(UX-098).
 * 단건 재전달(retryWebhook)과 같은 잠금 순서·상태 조건·감사 기록을 쓴다. 상태 조건으로 이미 대기·전달 중·완료인
 * 전달은 바꾸지 않으므로 두 번 눌러도 중복 발송하지 않는다.
 */
export async function retryWebhookDeliveries(
    actor: SalesActor,
    endpointId: string,
    state: "retry" | "dead" | "cancelled",
    exec: DbExec = db,
) {
    return exec.transaction(async (tx) => {
        const endpoint = await ownedWebhook(actor, endpointId, tx, true);
        await requireCustomerAccess(actor, endpoint.workspaceId, "manage", tx);
        if (!endpoint.enabled)
            throw new InboxError("웹훅을 켠 뒤 재시도해주세요.", 409);
        const scope = and(
            eq(deliveries.endpointId, endpoint.id),
            eq(deliveries.orgId, actor.orgId),
            eq(deliveries.state, state),
        );
        const targets = await tx
            .select({ id: deliveries.id })
            .from(deliveries)
            .where(scope)
            .orderBy(asc(deliveries.createdAt), asc(deliveries.id))
            .limit(BULK_RETRY_LIMIT)
            .for("update");
        if (!targets.length) return { retried: 0, remaining: false };
        const saved = await tx
            .update(deliveries)
            .set({
                state: "pending",
                endpointVersion: endpoint.generation,
                cycleAttempts: 0,
                availableAt: new Date(),
                leaseId: null,
                leaseUntil: null,
                lastError: null,
                lastStatus: null,
            })
            .where(
                and(
                    scope,
                    inArray(
                        deliveries.id,
                        targets.map((t) => t.id),
                    ),
                ),
            )
            .returning({ id: deliveries.id });
        if (saved.length)
            await tx.insert(audit).values(
                saved.map(() => ({
                    endpointId: endpoint.id,
                    actorName: actor.name,
                    action: "delivery.retried",
                    version: endpoint.version,
                })),
            );
        return {
            retried: saved.length,
            remaining: targets.length === BULK_RETRY_LIMIT,
        };
    });
}
export async function retryWebhook(
    actor: SalesActor,
    id: string,
    exec: DbExec = db,
) {
    return exec.transaction(async (tx) => {
        // Endpoint first: same lock order as settings mutation, then re-read delivery under lock.
        const row = await ownedDelivery(actor, id, tx),
            endpoint = await ownedWebhook(actor, row.endpointId, tx, true),
            current = await ownedDelivery(actor, id, tx, true);
        await requireCustomerAccess(actor, endpoint.workspaceId, "manage", tx);
        if (!endpoint.enabled)
            throw new InboxError("웹훅을 켠 뒤 재시도해주세요.", 409);
        if (!["retry", "dead", "cancelled"].includes(current.state))
            throw new InboxError(
                "실패하거나 취소된 전달만 재시도할 수 있습니다.",
                409,
            );
        const [saved] = await tx
            .update(deliveries)
            .set({
                state: "pending",
                endpointVersion: endpoint.generation,
                cycleAttempts: 0,
                availableAt: new Date(),
                leaseId: null,
                leaseUntil: null,
                lastError: null,
                lastStatus: null,
            })
            .where(eq(deliveries.id, id))
            .returning();
        await tx.insert(audit).values({
            endpointId: endpoint.id,
            actorName: actor.name,
            action: "delivery.retried",
            version: endpoint.version,
        });
        return saved;
    });
}
