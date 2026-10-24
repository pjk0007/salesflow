import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

const ADMIN_ONLY = "관리자만 변경할 수 있습니다.";

export async function PUT(req: NextRequest) {
    // 조직 전체의 알림톡 발송에 영향을 주는 변경이라 관리자만 한다
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        const error = auth.status === 403 ? ADMIN_ONLY : auth.error;
        return NextResponse.json({ success: false, error }, { status: auth.status });
    }
    const user = auth.user;

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

        // 이 조직 앱 키에 등록된 발신프로필인지 확인한다 — 남의 키나 오타를 기본값으로 두면 모든 발송이 실패한다
        const client = await getAlimtalkClient(user.orgId);
        const sender = client ? await client.getSender(String(senderKey)) : null;
        if (!sender?.header?.isSuccessful || sender.senderKey !== senderKey) {
            return NextResponse.json({ success: false, error: "이 조직에 등록된 발신프로필이 아닙니다." }, { status: 400 });
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
