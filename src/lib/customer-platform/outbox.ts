import {onOperationsEvent} from "@/lib/inbox-operations/enqueue";
import { enqueueInboxChatAlert } from "@/lib/inbox-chat-alerts/enqueue";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
    platformEvents,
    platformWebhooks,
    platformWebhookDeliveries,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { webhookEventTypes } from "./webhook-rules";
import { workflowOrigin } from "../customer-workflows/origin";
import { enqueueWorkflowRuns } from "../customer-workflows/enqueue";
import { importOrigin } from "../customer-imports/origin";
export type PlatformEventType = (typeof webhookEventTypes)[number];
/** Must use the source mutation's transaction. Never perform HTTP here. */
export async function enqueuePlatformEvent(
    exec: DbExec,
    input: {
        orgId: string;
        workspaceId: number;
        key: string;
        type: PlatformEventType;
        data: Record<string, unknown>;
        occurredAt?: Date;
        endpointId?: string;
    },
) {
    if (importOrigin()) return null;
    const id = randomUUID(),
        payload = {
            id,
            type: input.type,
            apiVersion: "2026-10-14",
            workspaceId: input.workspaceId,
            occurredAt: (input.occurredAt ?? new Date()).toISOString(),
            data: JSON.parse(JSON.stringify(input.data)),
        };
    const [event] = await exec
        .insert(platformEvents)
        .values({
            id,
            orgId: input.orgId,
            workspaceId: input.workspaceId,
            eventKey: input.key,
            type: input.type,
            payload,
            workflowRunId: workflowOrigin() ?? null,
        })
        .onConflictDoNothing({
            target: [platformEvents.workspaceId, platformEvents.eventKey],
        })
        .returning();
    if (!event) return null;
    event.payload = { ...event.payload, sequence: String(event.sequence) };
    await exec
        .update(platformEvents)
        .set({ payload: event.payload })
        .where(eq(platformEvents.id, event.id));
    const endpoints = await exec
        .select()
        .from(platformWebhooks)
        .where(
            and(
                eq(platformWebhooks.orgId, input.orgId),
                eq(platformWebhooks.workspaceId, input.workspaceId),
                eq(platformWebhooks.enabled, true),
                input.endpointId
                    ? eq(platformWebhooks.id, input.endpointId)
                    : sql`${platformWebhooks.eventTypes} @> ${JSON.stringify([input.type])}::jsonb`,
            ),
        )
        .for("share");
    if (endpoints.length)
        await exec
            .insert(platformWebhookDeliveries)
            .values(
                endpoints.map((e) => ({
                    orgId: input.orgId,
                    workspaceId: input.workspaceId,
                    endpointId: e.id,
                    endpointVersion: e.generation,
                    eventId: event.id,
                })),
            )
            .onConflictDoNothing();
    await onOperationsEvent(exec,event);
    await enqueueInboxChatAlert(exec, event);
    await enqueueWorkflowRuns(exec, event);
    return event;
}
