import { NextRequest } from "next/server";
import { recordClick, appendSendbCid } from "@/lib/email-click-tracking";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const idStr = searchParams.get("id");
    const url = searchParams.get("url");

    if (!idStr || !url) {
        return new Response("Missing parameters", { status: 400 });
    }

    const sendLogId = Number(idStr);
    if (!sendLogId) {
        return new Response("Invalid id", { status: 400 });
    }

    const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        undefined;
    const userAgent = req.headers.get("user-agent") || undefined;

    // 클릭 기록 + click_id 발급. 실패해도 redirect는 진행.
    let finalUrl = url;
    try {
        const result = await recordClick(sendLogId, url, ip, userAgent);
        if (result?.clickId) {
            finalUrl = appendSendbCid(url, result.clickId);
        }
    } catch (err) {
        console.error("recordClick error:", err);
    }

    return new Response(null, {
        status: 302,
        headers: { Location: finalUrl },
    });
}
