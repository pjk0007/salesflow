import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { checkChatWebhooks } from "@/lib/chat-webhook-check";
import { describeReplyError } from "@/lib/email-reply-rules";

/**
 * 웹훅 연결 확인 (구글 챗 QA WPN-11) — 관리자만. 이 조직이 쓰는 구글 챗 받는 곳마다 "연결 확인" 한 통을 보내고
 * 결과를 한국어로 돌려준다 ({ results: [{ source, label, ok, message }] }, 주소·key·token 없음). 조직마다 10분에 한 번
 */
export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    try {
        const r = await checkChatWebhooks({ orgId: auth.user.orgId, actorName: auth.user.name ?? null });
        if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: r.status });
        return NextResponse.json({ success: true, data: { results: r.results } });
    } catch (error) {
        console.error("[send-health] webhook check error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "연결 확인을 하지 못했습니다." }, { status: 500 });
    }
}
