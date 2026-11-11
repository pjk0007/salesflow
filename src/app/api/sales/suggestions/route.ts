import { NextRequest } from "next/server";
import { generateSuggestions, listSuggestions } from "@/lib/sales/suggestions";
import { ok, salesHandler } from "@/lib/sales/http";

// GET: 추천 할 일 목록 (?refresh=1이면 규칙을 다시 돌려 새 추천을 만든 뒤)
export async function GET(req: NextRequest) {
    return salesHandler(req, async (user) => {
        if (req.nextUrl.searchParams.get("refresh") === "1") await generateSuggestions(user);
        return ok(await listSuggestions(user));
    });
}
