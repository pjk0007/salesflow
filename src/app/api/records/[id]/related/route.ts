import { NextRequest } from "next/server";
import { findRelatedLeads, unlinkLead } from "@/lib/sales/related";
import { ok, recordGuard, salesHandler } from "@/lib/sales/http";

// GET: 같은 기업 담당자 (같은 기업명 + 같은 기업으로 묶은 리드, 모든 사업부)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return salesHandler(req, async (user) => {
        const recordId = Number((await params).id);
        const g = await recordGuard(user, recordId, "read");
        if (g.error) return g.error;
        return ok(await findRelatedLeads(user.orgId, recordId));
    });
}

// DELETE: 같은 기업 묶음에서 빼기 — 묶을 때 바꾼 기업명도 원래대로
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return salesHandler(req, async (user) => {
        const recordId = Number((await params).id);
        const g = await recordGuard(user, recordId, "update");
        if (g.error) return g.error;
        const body = (await req.json().catch(() => ({}))) as { companyName?: unknown };
        const name = typeof body.companyName === "string" ? body.companyName.trim().slice(0, 200) : "";
        await unlinkLead(user.orgId, recordId, name || null);
        return ok(null);
    });
}
