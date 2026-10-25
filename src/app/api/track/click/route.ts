import { NextRequest } from "next/server";
import { recordClick, appendSendbCid, verifiedClickTarget } from "@/lib/email-click-tracking";

/**
 * 메일 링크 클릭 추적 → 원래 주소로 이동. 서명이 맞는 링크(또는 유예 기간 안의 예전 링크)만 기록하고 이동한다 (UX-271) —
 * 아무 id·주소나 넣어 샌드비 도메인을 거쳐 외부로 보내는 열린 이동과 다른 조직 클릭 오염을 막는다.
 */
export async function GET(req: NextRequest) {
    let target: Awaited<ReturnType<typeof verifiedClickTarget>> = null;
    try {
        target = await verifiedClickTarget(req.nextUrl.searchParams);
    } catch (err) {
        console.error("click target check error:", err instanceof Error ? err.message : "unknown");
    }
    if (!target) {
        return new Response("링크가 올바르지 않거나 만료되었습니다.", {
            status: 400,
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
    }
    const { sendLogId, url } = target;

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
