import { NextRequest } from "next/server";
import { getRules, saveRule } from "@/lib/sales/suggestions";
import { fail, ok, salesHandler } from "@/lib/sales/http";

// GET: 영업 규칙 (오래 연락 안 함·명절 인사)
export async function GET(req: NextRequest) {
    return salesHandler(req, async (user) => ok(await getRules(user.orgId)));
}

// PUT: 규칙 저장 — 관리자만 {kind, enabled, days | daysBefore}
export async function PUT(req: NextRequest) {
    return salesHandler(req, async (user) => {
        if (user.role === "member") return fail("영업 규칙은 관리자만 바꿀 수 있습니다.", 403);
        const b = (await req.json()) as { kind?: string; enabled?: unknown; days?: unknown; daysBefore?: unknown };
        if (b.kind === "dormant") {
            const days = Math.round(Number(b.days));
            if (!(days >= 7 && days <= 365)) return fail("기준은 7~365일로 정해주세요.");
            await saveRule(user.orgId, "dormant", b.enabled !== false, { days });
        } else if (b.kind === "holiday") {
            const daysBefore = Math.round(Number(b.daysBefore));
            if (!(daysBefore >= 1 && daysBefore <= 30)) return fail("명절 며칠 전은 1~30일로 정해주세요.");
            await saveRule(user.orgId, "holiday", b.enabled !== false, { daysBefore });
        } else {
            return fail("잘못된 규칙입니다.");
        }
        return ok(await getRules(user.orgId));
    });
}
