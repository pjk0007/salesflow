import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PUT(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { senderKey } = await req.json();
        if (!senderKey) {
            return NextResponse.json({ success: false, error: "senderKey는 필수입니다." }, { status: 400 });
        }

        // 설정 존재 여부 확인
        const [existing] = await db
            .select({ id: alimtalkConfigs.id })
            .from(alimtalkConfigs)
            .where(eq(alimtalkConfigs.orgId, user.orgId))
            .limit(1);

        if (!existing) {
            return NextResponse.json({ success: false, error: "알림톡 설정이 없습니다." }, { status: 404 });
        }

        await db
            .update(alimtalkConfigs)
            .set({ defaultSenderKey: senderKey, updatedAt: new Date() })
            .where(eq(alimtalkConfigs.orgId, user.orgId));

        return NextResponse.json({
            success: true,
            message: "기본 발신프로필이 설정되었습니다.",
        });
    } catch (error) {
        console.error("Default sender update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
