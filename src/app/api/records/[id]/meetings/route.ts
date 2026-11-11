import { NextRequest } from "next/server";
import { createMeeting, listMeetings, parseMeetingInput } from "@/lib/sales/meetings";
import { fail, ok, recordGuard, salesHandler } from "@/lib/sales/http";

// GET: 영업 리드의 미팅 기록(최신순) + 액션플랜
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return salesHandler(req, async (user) => {
        const recordId = Number((await params).id);
        const g = await recordGuard(user, recordId, "read");
        if (g.error) return g.error;
        return ok(await listMeetings(recordId));
    });
}

// POST: 미팅 기록 추가 (액션플랜 같이)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return salesHandler(req, async (user) => {
        const recordId = Number((await params).id);
        const g = await recordGuard(user, recordId, "read");
        if (g.error) return g.error;
        const parsed = parseMeetingInput(await req.json());
        if (!parsed.ok) return fail(parsed.error);
        return ok(await createMeeting(user.orgId, user.userId, recordId, parsed.value), 201);
    });
}
