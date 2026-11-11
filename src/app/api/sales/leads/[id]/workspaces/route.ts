import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, records, workspaces } from "@/lib/db";
import { requireWorkspaceCreateAccess } from "@/lib/partition-access";
import { salesPartitionFor } from "@/lib/sales/leads";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// PUT: 영업 리드의 사업부 바꾸기 {workspaceIds} — 하나 이상. 등록 사업부가 빠지면 첫 번째 사업부로 옮긴다
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return salesHandler(req, async (user) => {
        const recordId = Number((await params).id);
        const g = await recordGuard(user, recordId, "update");
        if (g.error) return g.error;
        const b = (await req.json()) as { workspaceIds?: unknown };
        const ids = Array.isArray(b.workspaceIds) ? [...new Set(b.workspaceIds.map(Number).filter((n) => n > 0))] : [];
        if (ids.length === 0) return fail("사업부를 하나 이상 골라주세요.");
        const valid = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.orgId, user.orgId), inArray(workspaces.id, ids)));
        if (valid.length !== ids.length) return fail("사업부를 찾을 수 없습니다.", 404);
        const [rec] = await db.select().from(records).where(eq(records.id, recordId));
        const data = { ...(rec.data as Record<string, unknown>) };
        let workspaceId = rec.workspaceId;
        let partitionId = rec.partitionId;
        if (!ids.includes(rec.workspaceId)) {
            // 등록 사업부를 뺐으면 남은 첫 사업부의 영업 리드함으로 옮긴다
            const access = await requireWorkspaceCreateAccess(user, ids[0]);
            if (!access.ok) return fail(access.error, access.status);
            workspaceId = ids[0];
            partitionId = await salesPartitionFor(ids[0]);
        }
        data.workspaceIds = [workspaceId, ...ids.filter((id) => id !== workspaceId)];
        const [updated] = await db
            .update(records)
            .set({ workspaceId, partitionId, data, updatedAt: new Date() })
            .where(eq(records.id, recordId))
            .returning();
        return ok(updated);
    });
}
