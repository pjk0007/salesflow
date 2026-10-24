import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest, sealOAuthState } from "@/lib/auth";
import { db } from "@/lib/db";
import { adPlatforms } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { MetaCredentials } from "@/types";

export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const platformId = req.nextUrl.searchParams.get("platformId");
    if (!platformId) {
        return NextResponse.json({ success: false, error: "platformId가 필요합니다." }, { status: 400 });
    }

    // DB에서 플랫폼의 appId 조회
    const [platform] = await db
        .select()
        .from(adPlatforms)
        .where(and(eq(adPlatforms.id, Number(platformId)), eq(adPlatforms.orgId, user.orgId)))
        .limit(1);

    if (!platform) {
        return NextResponse.json({ success: false, error: "플랫폼을 찾을 수 없습니다." }, { status: 404 });
    }

    const credentials = platform.credentials as MetaCredentials;
    if (!credentials.appId) {
        return NextResponse.json({ success: false, error: "Meta App ID가 설정되지 않았습니다." }, { status: 400 });
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/meta/callback`;
    const scopes = [
        "business_management",
        "pages_manage_ads",
        "leads_retrieval",
        "ads_read",
        "pages_show_list",
        "pages_read_engagement",
    ].join(",");

    // state에 orgId, userId, platformId를 봉인해 담는다 — 콜백에서 위조된 state로 다른 플랫폼 토큰을 덮어쓰지 못한다
    const state = sealOAuthState("meta", {
        orgId: user.orgId,
        userId: user.userId,
        platformId: platform.id,
    });

    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${credentials.appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${encodeURIComponent(state)}&response_type=code`;

    return NextResponse.json({ success: true, data: { authUrl } });
}
