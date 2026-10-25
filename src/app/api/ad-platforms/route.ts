import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db/errors";

const UNMASK_KEYS = new Set(["type", "webhookVerifyToken"]);

function maskSecret(value: unknown): unknown {
    if (typeof value === "string") return value ? (value.length > 8 ? value.substring(0, 4) + "****" : "****") : "";
    if (Array.isArray(value)) return value.map(maskSecret);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskSecret(item)]));
    return value;
}

function maskCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(credentials).map(([key, value]) => [key, UNMASK_KEYS.has(key) ? value : maskSecret(value)]));
}

export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
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
            status: p.platform === "meta" && !(p.credentials as Record<string, unknown>)?.accessToken ? "disconnected" : p.status,
            credentials: maskCredentials(p.credentials as Record<string, unknown>),
        }));

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Ad platforms list error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
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
                status: platform.trim() === "meta" && !credentials.accessToken ? "disconnected" : "connected",
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
        if (isUniqueViolation(error)) {
            return NextResponse.json({ success: false, error: "이미 동일한 이름의 플랫폼 연결이 존재합니다." }, { status: 409 });
        }
        console.error("Ad platform create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
