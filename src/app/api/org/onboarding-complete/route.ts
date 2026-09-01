import { NextRequest, NextResponse } from "next/server";
import { db, organizations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

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
