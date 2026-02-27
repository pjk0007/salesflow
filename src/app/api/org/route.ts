import { NextRequest, NextResponse } from "next/server";
import { db, organizations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PUT(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        const { name, industry, companySize } = await req.json();

        const [org] = await db
            .select({ id: organizations.id, settings: organizations.settings })
            .from(organizations)
            .where(eq(organizations.id, user.orgId));

        if (!org) {
            return NextResponse.json({ success: false, error: "조직을 찾을 수 없습니다." }, { status: 404 });
        }

        const currentSettings = (org.settings as Record<string, unknown>) ?? {};
        const updatedSettings = {
            ...currentSettings,
            ...(industry !== undefined ? { industry } : {}),
            ...(companySize !== undefined ? { companySize } : {}),
        };

        const [updated] = await db
            .update(organizations)
            .set({
                ...(name?.trim() ? { name: name.trim() } : {}),
                settings: updatedSettings,
                updatedAt: new Date(),
            })
            .where(eq(organizations.id, user.orgId))
            .returning({
                id: organizations.id,
                name: organizations.name,
                settings: organizations.settings,
            });

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Org update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
