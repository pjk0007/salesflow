import { NextRequest } from "next/server";
import { listSalesCompanies } from "@/lib/sales/leads";
import { ok, salesHandler } from "@/lib/sales/http";

// GET: 영업 리드 기업 목록 (다른 기업으로 옮길 때 고르기)
export async function GET(req: NextRequest) {
    return salesHandler(req, async (user) => ok(await listSalesCompanies(user)));
}
