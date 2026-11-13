import { NextRequest } from "next/server";
import { linkLeads } from "@/lib/sales/related";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// POST: 고른 영업 리드들을 같은 기업으로 묶기 {recordIds: number[], companyName: 기준 기업명}
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const b = (await req.json()) as { recordIds?: unknown; companyName?: unknown };
        const companyName = typeof b.companyName === "string" ? b.companyName.trim().slice(0, 200) : "";
        if (!companyName) return fail("기준 기업명을 골라주세요.");
        const ids = Array.isArray(b.recordIds) ? [...new Set(b.recordIds.map(Number).filter((n) => n > 0))] : [];
        if (ids.length < 2) return fail("묶을 영업고객을 2명 이상 골라주세요.");
        if (ids.length > 50) return fail("한 번에 50개까지 묶을 수 있습니다.");
        for (const id of ids) {
            const g = await recordGuard(user, id, "update");
            if (g.error) return g.error;
        }
        return ok(await linkLeads(user.orgId, ids, companyName));
    });
}
