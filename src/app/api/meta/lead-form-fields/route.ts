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
    const formId = req.nextUrl.searchParams.get("formId");

    if (!platformId) {
        return NextResponse.json({ success: false, error: "플랫폼 ID가 필요합니다." }, { status: 400 });
    }
    if (!formId) {
        return NextResponse.json({ success: false, error: "양식 ID가 필요합니다." }, { status: 400 });
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
            `https://graph.facebook.com/v21.0/${formId}?access_token=${accessToken}&fields=id,name,questions`
        );

        if (!response.ok) {
            const error = await response.json();
            console.error("Meta lead form fields API error:", error);
            return NextResponse.json(
                { success: false, error: "Meta API에서 양식 필드를 가져오는데 실패했습니다." },
                { status: 502 }
            );
        }

        const result = await response.json();
        const fields = (result.questions || []).map((q: { key: string; label: string; type: string }) => ({
            key: q.key,
            label: q.label,
            type: q.type,
        }));

        return NextResponse.json({
            success: true,
            data: {
                id: result.id,
                name: result.name,
                fields,
            },
        });
    } catch (error) {
        console.error("Meta lead form fields fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
