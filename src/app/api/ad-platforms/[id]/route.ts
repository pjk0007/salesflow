import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
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

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const platformId = Number(id);
    if (!platformId) {
        return NextResponse.json({ success: false, error: "플랫폼 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [platform] = await db
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
            .where(and(eq(adPlatforms.id, platformId), eq(adPlatforms.orgId, user.orgId)));

        if (!platform) {
            return NextResponse.json({ success: false, error: "플랫폼을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: {
                ...platform,
                credentials: maskCredentials(platform.credentials as Record<string, unknown>),
            },
        });
    } catch (error) {
        console.error("Ad platform get error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const platformId = Number(id);
    if (!platformId) {
        return NextResponse.json({ success: false, error: "플랫폼 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [existing] = await db
            .select({ id: adPlatforms.id })
            .from(adPlatforms)
            .where(and(eq(adPlatforms.id, platformId), eq(adPlatforms.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "플랫폼을 찾을 수 없습니다." }, { status: 404 });
        }

        const { name, credentials, status } = await req.json();

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (name !== undefined) updates.name = name.trim();
        if (credentials !== undefined) updates.credentials = credentials;
        if (status !== undefined) updates.status = status;

        const [updated] = await db
            .update(adPlatforms)
            .set(updates)
            .where(eq(adPlatforms.id, platformId))
            .returning();

        return NextResponse.json({
            success: true,
            data: {
                ...updated,
                credentials: maskCredentials(updated.credentials as Record<string, unknown>),
            },
        });
    } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes("unique")) {
            return NextResponse.json({ success: false, error: "이미 동일한 이름의 플랫폼 연결이 존재합니다." }, { status: 409 });
        }
        console.error("Ad platform update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const platformId = Number(id);
    if (!platformId) {
        return NextResponse.json({ success: false, error: "플랫폼 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [existing] = await db
            .select({ id: adPlatforms.id })
            .from(adPlatforms)
            .where(and(eq(adPlatforms.id, platformId), eq(adPlatforms.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "플랫폼을 찾을 수 없습니다." }, { status: 404 });
        }

        await db.delete(adPlatforms).where(eq(adPlatforms.id, platformId));

        return NextResponse.json({ success: true, message: "광고 플랫폼이 삭제되었습니다." });
    } catch (error) {
        console.error("Ad platform delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
