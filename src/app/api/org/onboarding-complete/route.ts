import { NextRequest, NextResponse } from "next/server";
import { db, organizations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        await db
            .update(organizations)
            .set({
                onboardingCompleted: true,
                updatedAt: new Date(),
            })
            .where(eq(organizations.id, user.orgId));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Onboarding complete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
