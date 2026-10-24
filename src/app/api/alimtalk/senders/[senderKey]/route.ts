import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

const ADMIN_ONLY = "관리자만 변경할 수 있습니다.";

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ senderKey: string }> }
) {
    // 조직 전체의 알림톡 발송에 영향을 주는 변경이라 관리자만 한다
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        const error = auth.status === 403 ? ADMIN_ONLY : auth.error;
        return NextResponse.json({ success: false, error }, { status: auth.status });
    }
    const user = auth.user;

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    try {
        const { senderKey } = await params;
        if (!senderKey) {
            return NextResponse.json({ success: false, error: "senderKey는 필수입니다." }, { status: 400 });
        }

        const result = await client.deleteSender(senderKey);

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({
            success: true,
            message: "발신프로필이 삭제되었습니다.",
        });
    } catch (error) {
        console.error("Sender delete error:", error);
        return NextResponse.json({ success: false, error: "발신프로필 삭제에 실패했습니다." }, { status: 500 });
    }
}
