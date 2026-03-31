import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

const UNMASK_KEYS = new Set(["type", "webhookVerifyToken"]);

function maskCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(credentials)) {
        if (UNMASK_KEYS.has(key)) {
            masked[key] = value;
        } else if (typeof value === "string" && value.length > 8) {
            masked[key] = value.substring(0, 4) + "****";
        } else {
            masked[key] = value;
        }
    }
    return masked;
}

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const platforms = await db
            .select({
                id: adPlatforms.id,
                orgId: adPlatforms.orgId,
                platform: adPlatforms.platform,
                name: adPlatforms.name,
                credentials: adPlatforms.credentials,
                status: adPlatforms.status,
                lastSyncAt: adPlatforms.lastSyncAt,
                createdBy: adPlatforms.createdBy,
                createdAt: adPlatforms.createdAt,
                updatedAt: adPlatforms.updatedAt,
                createdByName: users.name,
            })
            .from(adPlatforms)
            .leftJoin(users, eq(adPlatforms.createdBy, users.id))
            .where(eq(adPlatforms.orgId, user.orgId))
            .orderBy(desc(adPlatforms.createdAt));

        const data = platforms.map((p) => ({
            ...p,
            credentials: maskCredentials(p.credentials as Record<string, unknown>),
        }));

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Ad platforms list error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { platform, name, credentials } = await req.json();

    if (!platform?.trim()) {
        return NextResponse.json({ success: false, error: "플랫폼을 선택해주세요." }, { status: 400 });
    }
    if (!name?.trim()) {
        return NextResponse.json({ success: false, error: "연결 이름을 입력해주세요." }, { status: 400 });
    }
    if (!credentials || typeof credentials !== "object") {
        return NextResponse.json({ success: false, error: "인증 정보를 입력해주세요." }, { status: 400 });
    }

    try {
        const [created] = await db
            .insert(adPlatforms)
            .values({
                orgId: user.orgId,
                platform: platform.trim(),
                name: name.trim(),
                credentials,
                createdBy: user.userId,
            })
            .returning();

        return NextResponse.json({
            success: true,
            data: {
                ...created,
                credentials: maskCredentials(created.credentials as Record<string, unknown>),
            },
        }, { status: 201 });
    } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes("unique")) {
            return NextResponse.json({ success: false, error: "이미 동일한 이름의 플랫폼 연결이 존재합니다." }, { status: 409 });
        }
        console.error("Ad platform create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
