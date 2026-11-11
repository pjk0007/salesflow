import { NextRequest } from "next/server";
import { listSalesTodos } from "@/lib/sales/todos";
import { ok, salesHandler } from "@/lib/sales/http";

// GET: 영업ToDo — 액션플랜 목록 (?done=1이면 끝난 것도)
export async function GET(req: NextRequest) {
    return salesHandler(req, async (user) => ok(await listSalesTodos(user, { includeDone: req.nextUrl.searchParams.get("done") === "1" })));
}
