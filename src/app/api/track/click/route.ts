import { NextRequest } from "next/server";
import { recordClick } from "@/lib/email-click-tracking";

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

    // 클릭 기록 (비동기, 리다이렉트를 지연시키지 않음)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
    const userAgent = req.headers.get("user-agent") || undefined;

    // 기록은 fire-and-forget으로 처리
    recordClick(sendLogId, url, ip, userAgent).catch(console.error);

    // 원본 URL로 리다이렉트
    return new Response(null, {
        status: 302,
        headers: { Location: url },
    });
}
