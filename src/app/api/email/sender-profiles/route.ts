import { NextRequest, NextResponse } from "next/server";
import { db, emailSenderProfiles } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const profiles = await db
            .select()
            .from(emailSenderProfiles)
            .where(eq(emailSenderProfiles.orgId, user.orgId))
            .orderBy(emailSenderProfiles.createdAt);

        return NextResponse.json({ success: true, data: profiles });
    } catch (error) {
        console.error("Sender profiles fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { name, fromName, fromEmail } = await req.json();
        if (!name || !fromName || !fromEmail) {
            return NextResponse.json({ success: false, error: "이름, 발신자명, 발신 이메일은 필수입니다." }, { status: 400 });
        }

        // 첫 프로필이면 isDefault=true
        const existing = await db
            .select({ id: emailSenderProfiles.id })
            .from(emailSenderProfiles)
            .where(eq(emailSenderProfiles.orgId, user.orgId))
            .limit(1);

        const isDefault = existing.length === 0;

        const [profile] = await db
            .insert(emailSenderProfiles)
            .values({
                orgId: user.orgId,
                name: name.trim(),
                fromName: fromName.trim(),
                fromEmail: fromEmail.trim().toLowerCase(),
                isDefault,
            })
            .returning();

        return NextResponse.json({ success: true, data: profile }, { status: 201 });
    } catch (error) {
        console.error("Sender profile create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
