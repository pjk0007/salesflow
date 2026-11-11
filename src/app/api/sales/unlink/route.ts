import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, records } from "@/lib/db";
import { unlinkLead } from "@/lib/sales/related";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// POST: 고른 리드들을 같은 기업 묶음에서 빼기 {recordIds} — 묶을 때 바꾼 기업명은 원래대로
// 같은 기업으로 '묶은' 리드만 뺄 수 있다 (기업명이 원래 같은 리드는 이름을 바꿔야 떨어지므로 건너뛴다)
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const b = (await req.json()) as { recordIds?: unknown };
        const ids = Array.isArray(b.recordIds) ? [...new Set(b.recordIds.map(Number).filter((n) => n > 0))] : [];
        if (ids.length === 0) return fail("뺄 리드를 골라주세요.");
        for (const id of ids) {
            const g = await recordGuard(user, id, "update");
            if (g.error) return g.error;
        }
        const rows = await db.select({ id: records.id, data: records.data }).from(records).where(and(eq(records.orgId, user.orgId), inArray(records.id, ids)));
        let done = 0;
        for (const r of rows) {
            const group = (r.data as Record<string, unknown>).leadGroupId;
            if (typeof group !== "string" || !group) continue;
            await unlinkLead(user.orgId, r.id);
            done++;
        }
        return ok({ done, skipped: ids.length - done });
    });
}
