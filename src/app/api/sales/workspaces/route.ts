import { NextRequest } from "next/server";
import { salesWorkspaceCounts } from "@/lib/sales/leads";
import { ok, salesHandler } from "@/lib/sales/http";

// GET: 사업부별 영업 리드 수 — 영업관리 윗줄 탭(리드 있는 사업부만 보인다)
export async function GET(req: NextRequest) {
    return salesHandler(req, async (user) => ok(await salesWorkspaceCounts(user)));
}
