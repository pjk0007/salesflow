import { customerChanges } from "./changes";
import { and, eq, inArray } from "drizzle-orm";
import { crmCompanies, crmObjectAudit } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { CustomerActor } from "@/lib/customer-access/access";
import type { CustomerResource } from "./rules";
import { appendActivity } from "@/lib/customer-platform/activities";
export type CustomerWrite = {
    actor?: Pick<CustomerActor, "userId" | "name">;
    source?: "staff" | "api" | "workflow" | "import" | "email" | "system";
    replaceAttributes?: boolean;
};
type Snapshot = Record<string, unknown> & {
    orgId: string;
    workspaceId: number;
    id: string;
    version: number;
};
export async function appendCustomerAudit(
    exec: DbExec,
    resource: CustomerResource,
    before: Record<string, unknown> | null,
    after: Snapshot,
    write: CustomerWrite = {},
    action = before ? "updated" : "created",
    reason = "",
) {
    const changes = customerChanges(before, after);
    if (!Object.keys(changes).length) return null;
    if (changes.companyIds) {
        const ids = [
            ...new Set([
                ...(Array.isArray(changes.companyIds.before)
                    ? changes.companyIds.before
                    : []),
                ...(Array.isArray(changes.companyIds.after)
                    ? changes.companyIds.after
                    : []),
            ]),
        ] as string[];
        const companies = ids.length
            ? await exec
                  .select({ id: crmCompanies.id, name: crmCompanies.name })
                  .from(crmCompanies)
                  .where(
                      and(
                          eq(crmCompanies.orgId, after.orgId),
                          eq(crmCompanies.workspaceId, after.workspaceId),
                          inArray(crmCompanies.id, ids),
                      ),
                  )
            : [];
        const label = (values: unknown) =>
            Array.isArray(values) && values.length
                ? values
                      .map(
                          (id) =>
                              companies.find((c) => c.id === id)?.name ??
                              `이전 회사 ${String(id).slice(0, 8)}`,
                      )
                      .join(", ")
                : "없음";
        changes.companyIds.beforeLabel = label(changes.companyIds.before);
        changes.companyIds.afterLabel = label(changes.companyIds.after);
    }
    const [event] = await exec
        .insert(crmObjectAudit)
        .values({
            orgId: after.orgId,
            workspaceId: after.workspaceId,
            resource,
            objectId: after.id,
            version: after.version,
            action,
            actorId: write.actor?.userId,
            actorName: (write.actor?.name ?? "시스템 연동").slice(0, 100),
            source: write.source ?? "system",
            changes,
            reason,
        })
        .onConflictDoNothing()
        .returning();
    if (event)
        await appendActivity(exec, {
            orgId: after.orgId,
            workspaceId: after.workspaceId,
            contactId: resource === "contacts" ? after.id : null,
            companyId: resource === "companies" ? after.id : null,
            source: "profile",
            entityId: after.id,
            eventKey: `customer-audit:${event.id}`,
            action: `${resource}.${action}`,
            summary: `${resource === "contacts" ? "고객" : "회사"} 정보 ${action === "created" ? "등록" : action === "archived" ? "보관" : action === "restored" ? "복구" : "변경"}`,
            actorName: event.actorName,
            metadata: {
                auditId: event.id,
                version: after.version,
                changes,
                source: event.source,
            },
            occurredAt: event.createdAt,
        });
    return event ?? null;
}
