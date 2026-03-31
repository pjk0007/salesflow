import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type { MetaCredentials } from "@/types";

type PageData = { id: string; name: string; access_token: string };

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

        // 1차: me/accounts (개인이 관리하는 페이지)
        const response = await fetch(
            `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}&fields=id,name,access_token&limit=100`
        );
        const result = await response.json();
        let pages = (result.data || []).map((page: { id: string; name: string; access_token: string }) => ({
            id: page.id,
            name: page.name,
            accessToken: page.access_token,
        }));

        // 2차: 비즈니스 관리자 소유 페이지 (me/accounts에 안 잡히는 경우)
        if (pages.length === 0) {
            try {
                const bizRes = await fetch(
                    `https://graph.facebook.com/v21.0/me/businesses?access_token=${accessToken}&fields=id,name`
                );
                const bizData = await bizRes.json();
                for (const biz of bizData.data || []) {
                    const pagesRes = await fetch(
                        `https://graph.facebook.com/v21.0/${biz.id}/owned_pages?access_token=${accessToken}&fields=id,name,access_token&limit=100`
                    );
                    const pagesData = await pagesRes.json();
                    const bizPages = (pagesData.data || []).map((page: { id: string; name: string; access_token: string }) => ({
                        id: page.id,
                        name: page.name,
                        accessToken: page.access_token,
                    }));
                    pages = [...pages, ...bizPages];
                }
            } catch (err) {
                console.error("Business pages fetch error:", err);
            }
        }

        // pageAccessTokens를 DB에 저장 (리드폼 조회 등에서 사용)
        if (pages.length > 0) {
            const pageAccessTokens: Record<string, string> = {};
            for (const page of pages) {
                if (page.accessToken) {
                    pageAccessTokens[page.id] = page.accessToken;
                }
            }
            await db
                .update(adPlatforms)
                .set({
                    credentials: {
                        ...credentials,
                        pageAccessTokens,
                    },
                    updatedAt: new Date(),
                })
                .where(eq(adPlatforms.id, platformId));
        }

        return NextResponse.json({ success: true, data: pages });
    } catch (error) {
        console.error("Meta pages fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
