import { and, desc, eq, lt, or } from "drizzle-orm";
import { db, crmActivities } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
import { platformContact } from "./repository";
import { importOrigin } from "../customer-imports/origin";
export async function appendActivity(
    exec: DbExec,
    input: typeof crmActivities.$inferInsert,
) {
    const imported = importOrigin();
    await exec
        .insert(crmActivities)
        .values({
            ...input,
            ...(imported
                ? {
                      metadata: {
                          ...input.metadata,
                          importJobId: imported.jobId,
                      },
                      occurredAt: imported.occurredAt ?? input.occurredAt,
                  }
                : {}),
            summary: `${imported ? "이전 자료 · " : ""}${input.summary}`.slice(
                0,
                200,
            ),
            actorName: input.actorName?.slice(0, 100),
        })
        .onConflictDoNothing({
            target: [crmActivities.workspaceId, crmActivities.eventKey],
        });
}
export async function customerActivities(
    orgId: string,
    workspaceId: number,
    contactId: string,
    before?: string,
    exec: DbExec = db,
) {
    await platformContact(orgId, workspaceId, contactId, exec);
    const scoped = and(
        eq(crmActivities.orgId, orgId),
        eq(crmActivities.workspaceId, workspaceId),
        eq(crmActivities.contactId, contactId),
    );
    const [cursor] = before
        ? await exec
              .select()
              .from(crmActivities)
              .where(and(scoped, eq(crmActivities.id, before)))
        : [];
    if (before && !cursor)
        throw new InboxError("고객 활동 페이지를 찾을 수 없습니다.");
    const rows = await exec
        .select()
        .from(crmActivities)
        .where(
            and(
                scoped,
                cursor
                    ? or(
                          lt(crmActivities.occurredAt, cursor.occurredAt),
                          and(
                              eq(crmActivities.occurredAt, cursor.occurredAt),
                              lt(crmActivities.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(crmActivities.occurredAt), desc(crmActivities.id))
        .limit(100);
    return rows.map((row) => ({
        ...row,
        name: row.action,
        properties: row.metadata,
    }));
}
