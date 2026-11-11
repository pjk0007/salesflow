import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, records } from "@/lib/db";
import { unlinkLead } from "@/lib/sales/related";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// POST: 고른 리드들을 묶인 기업에서 빼기 {recordIds, companyName?}
// companyName을 주면 모두 그 기업(새 이름 또는 다른 기업)으로 옮기고, 없으면 묶기 전 이름으로 되돌린다
// (이름이 원래 같아서 묶인 리드는 companyName 없이는 뗄 수 없어 건너뛴다)
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const b = (await req.json()) as { recordIds?: unknown; companyName?: unknown };
        const companyName = typeof b.companyName === "string" ? b.companyName.trim().slice(0, 200) : "";
        const ids = Array.isArray(b.recordIds) ? [...new Set(b.recordIds.map(Number).filter((n) => n > 0))] : [];
        if (ids.length === 0) return fail("뺄 리드를 골라주세요.");
        for (const id of ids) {
            const g = await recordGuard(user, id, "update");
            if (g.error) return g.error;
        }
        const rows = await db.select({ id: records.id, data: records.data }).from(records).where(and(eq(records.orgId, user.orgId), inArray(records.id, ids)));
        let done = 0;
        for (const r of rows) {
            const d = r.data as Record<string, unknown>;
            const grouped = typeof d.leadGroupId === "string" && !!d.leadGroupId;
            if (!companyName && !(grouped && typeof d.originalCompanyName === "string")) continue;
            await unlinkLead(user.orgId, r.id, companyName || null);
            done++;
        }
        return ok({ done, skipped: ids.length - done });
    });
}
