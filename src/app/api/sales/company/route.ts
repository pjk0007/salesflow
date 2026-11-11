import { NextRequest } from "next/server";
import { setCompanyAddress } from "@/lib/sales/related";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// POST: 회사 주소 저장 — 같은 기업 담당자 모두에 같이 적용 {recordId, address}
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const b = (await req.json()) as { recordId?: unknown; address?: unknown };
        const recordId = Number(b.recordId);
        const g = await recordGuard(user, recordId, "update");
        if (g.error) return g.error;
        if (typeof b.address !== "string") return fail("주소를 입력해주세요.");
        return ok(await setCompanyAddress(user.orgId, recordId, b.address.trim().slice(0, 300)));
    });
}
