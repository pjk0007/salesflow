import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type { MetaCredentials } from "@/types";

const ACCOUNT_STATUS_MAP: Record<number, string> = {
    1: "active",
    2: "disabled",
    3: "unsettled",
    7: "pending_risk_review",
    8: "pending_settlement",
    9: "in_grace_period",
    100: "pending_closure",
    101: "closed",
    201: "any_active",
    202: "any_closed",
};

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const platformId = Number(req.nextUrl.searchParams.get("platformId"));
    if (!platformId) {
        return NextResponse.json({ success: false, error: "플랫폼 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [platform] = await db
            .select()
            .from(adPlatforms)
            .where(and(eq(adPlatforms.id, platformId), eq(adPlatforms.orgId, user.orgId)));

        if (!platform) {
            return NextResponse.json({ success: false, error: "플랫폼을 찾을 수 없습니다." }, { status: 404 });
        }

        const credentials = platform.credentials as MetaCredentials;
        const accessToken = credentials.accessToken;

        const response = await fetch(
            `https://graph.facebook.com/v21.0/me/adaccounts?access_token=${accessToken}&fields=id,name,account_status,currency,amount_spent`
        );

        if (!response.ok) {
            const error = await response.json();
            console.error("Meta ad accounts API error:", error);
            return NextResponse.json(
                { success: false, error: "Meta API에서 광고 계정 목록을 가져오는데 실패했습니다." },
                { status: 502 }
            );
        }

        const result = await response.json();
        const accounts = (result.data || []).map(
            (account: { id: string; name: string; account_status: number; currency: string; amount_spent: string }) => ({
                id: account.id,
                name: account.name,
                accountStatus: ACCOUNT_STATUS_MAP[account.account_status] || "unknown",
                currency: account.currency,
                amountSpent: account.amount_spent,
            })
        );

        return NextResponse.json({ success: true, data: accounts });
    } catch (error) {
        console.error("Meta ad accounts fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
