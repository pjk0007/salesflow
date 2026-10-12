import { NextRequest, NextResponse } from "next/server";
import { queryClient } from "@/lib/db";
import { getUserFromNextRequest } from "@/lib/auth";
import { getLeadFollowup, saveLeadFollowup, LeadFollowupError } from "@/lib/customer-journey-followup";
import { parseFollowupPatch } from "@/lib/customer-journey-followup-rules";

async function handle(req: NextRequest, params: Promise<{ id: string }>, write: boolean) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ success: false, error: "고객 ID를 확인해 주세요." }, { status: 400 });
    let patch;
    if (write) {
        try { patch = parseFollowupPatch(await req.json()); }
        catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "입력값을 확인해 주세요." }, { status: 400 }); }
    }
    const conn = await queryClient.reserve();
    try {
        const data = patch ? await saveLeadFollowup(conn, user, id, patch) : await getLeadFollowup(conn, user.orgId, id);
        return NextResponse.json({ success: true, data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error instanceof LeadFollowupError ? error.message : "후속 대응 상태를 처리하지 못했습니다." },
            { status: error instanceof LeadFollowupError ? error.status : 500 });
    } finally { conn.release(); }
}
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(req, params, false); }
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(req, params, true); }
