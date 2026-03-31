import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type { MetaCredentials } from "@/types";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const platformId = Number(req.nextUrl.searchParams.get("platformId"));
    const pageId = req.nextUrl.searchParams.get("pageId");

    if (!platformId) {
        return NextResponse.json({ success: false, error: "플랫폼 ID가 필요합니다." }, { status: 400 });
    }
    if (!pageId) {
        return NextResponse.json({ success: false, error: "페이지 ID가 필요합니다." }, { status: 400 });
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
        const pageAccessToken = credentials.pageAccessTokens?.[pageId] || credentials.accessToken;

        const response = await fetch(
            `https://graph.facebook.com/v21.0/${pageId}/leadgen_forms?access_token=${pageAccessToken}&fields=id,name,status,field_count`
        );

        if (!response.ok) {
            const error = await response.json();
            console.error("Meta lead forms API error:", error);
            return NextResponse.json(
                { success: false, error: "Meta API에서 리드 양식 목록을 가져오는데 실패했습니다." },
                { status: 502 }
            );
        }

        const result = await response.json();
        const forms = (result.data || []).map((form: { id: string; name: string; status: string; field_count: number }) => ({
            id: form.id,
            name: form.name,
            status: form.status,
            fieldCount: form.field_count,
        }));

        return NextResponse.json({ success: true, data: forms });
    } catch (error) {
        console.error("Meta lead forms fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
