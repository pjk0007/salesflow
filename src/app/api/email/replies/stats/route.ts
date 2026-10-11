import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { replyStatsByRule } from "@/lib/email-reply-list";
import { describeReplyError } from "@/lib/email-reply-rules";

/**
 * 규칙별 회신 수 (DESIGN-RPL 10-3) — AI 규칙 카드·템플릿 자동발송 목록의 "회신 3 · 28일" 배지.
 * { byRule: { "ai:12": { human, auto_reply, bounce }, "template:5": … }, total(사람 회신), days }
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    try {
        const raw = Number(req.nextUrl.searchParams.get("days"));
        const days = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 90) : 28;
        const stats = await replyStatsByRule(user.orgId, days);
        return NextResponse.json({ success: true, data: { ...stats, days } });
    } catch (error) {
        // 표가 없으면(마이그레이션 전) 빈 통계 — 배지가 없을 뿐 규칙 화면은 그대로
        if (describeReplyError(error).startsWith("42P01")) {
            return NextResponse.json({ success: true, data: { byRule: {}, total: 0, days: 28 } });
        }
        console.error("[replies] stats error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
