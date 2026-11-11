import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, records, workspaces } from "@/lib/db";
import { requireWorkspaceCreateAccess } from "@/lib/partition-access";
import { listSalesLeads, salesPartitionFor } from "@/lib/sales/leads";
import { fail, ok, salesHandler } from "@/lib/sales/http";

// GET: 영업 리드 목록 (?workspaceId=사업부, 없으면 전체 · mine=1 내 담당 · search · page)
export async function GET(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const sp = req.nextUrl.searchParams;
        const result = await listSalesLeads(user, {
            workspaceId: Number(sp.get("workspaceId")) || null,
            mine: sp.get("mine") === "1",
            search: (sp.get("search") || "").trim(),
            page: Math.max(1, Number(sp.get("page")) || 1),
            pageSize: Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 50)),
        });
        return NextResponse.json({ success: true, ...result });
    });
}

// POST: 영업 리드 추가 {workspaceIds: number[] (첫 번째가 등록 사업부), data}
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const b = (await req.json()) as { workspaceIds?: unknown; data?: unknown };
        const wsIds = Array.isArray(b.workspaceIds) ? [...new Set(b.workspaceIds.map(Number).filter((n) => n > 0))] : [];
        if (wsIds.length === 0) return fail("사업부를 하나 이상 골라주세요.");
        const valid = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.orgId, user.orgId), inArray(workspaces.id, wsIds)));
        if (valid.length !== wsIds.length) return fail("사업부를 찾을 수 없습니다.", 404);
        const home = wsIds[0];
        const access = await requireWorkspaceCreateAccess(user, home);
        if (!access.ok) return fail(access.error, access.status);
        const data = b.data && typeof b.data === "object" ? { ...(b.data as Record<string, unknown>) } : {};
        delete data.leadGroupId;
        const partitionId = await salesPartitionFor(home);
        const [created] = await db
            .insert(records)
            .values({ orgId: user.orgId, workspaceId: home, partitionId, data: { ...data, workspaceIds: wsIds } })
            .returning();
        return ok(created, 201);
    });
}
