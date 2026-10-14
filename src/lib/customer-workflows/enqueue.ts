import { workflowContext } from "./context";
import { and, eq, sql } from "drizzle-orm";
import {
    customerWorkflows as workflows,
    customerWorkflowRevisions as revisions,
    customerWorkflowRuns as runs,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { PlatformEventPayload } from "@/lib/db/platform-webhook-schema";
import { matchesTriggerEvent } from "./rules";
/** Event registration is atomic with source writes; action execution happens only in the worker. */
export async function enqueueWorkflowRuns(
    exec: DbExec,
    event: {
        id: string;
        orgId: string;
        workspaceId: number;
        type: string;
        payload: PlatformEventPayload;
        workflowRunId: string | null;
    },
) {
    if (event.workflowRunId || event.payload.data.administrative === true)
        return;
    const candidates = await exec
        .select({ workflow: workflows, revision: revisions })
        .from(workflows)
        .innerJoin(revisions, eq(revisions.id, workflows.activeRevisionId))
        .where(
            and(
                eq(workflows.orgId, event.orgId),
                eq(workflows.workspaceId, event.workspaceId),
                eq(workflows.enabled, true),
                sql`${revisions.definition}->'trigger'->'types' @> ${JSON.stringify([event.type])}::jsonb`,
            ),
        )
        .for("share", { of: workflows });
    if (!candidates.length) return;
    const context = await workflowContext(
        event.orgId,
        event.workspaceId,
        event.payload as unknown as Record<string, unknown>,
        exec,
    );
    if (context.archived) return;
    for (const { workflow, revision } of candidates) {
        if (!matchesTriggerEvent(revision.definition.trigger, event.payload))
            continue;
        await exec
            .insert(runs)
            .values({
                orgId: event.orgId,
                workspaceId: event.workspaceId,
                workflowId: workflow.id,
                revisionId: revision.id,
                generation: workflow.generation,
                eventId: event.id,
                subjectContactId: context.contact?.id ?? null,
                subjectCompanyId: context.company?.id ?? null,
                eventSnapshot: event.payload as unknown as Record<
                    string,
                    unknown
                >,
            })
            .onConflictDoNothing({ target: [runs.workflowId, runs.eventId] });
    }
}
