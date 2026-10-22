import { NextRequest, NextResponse } from "next/server";
import { db, chatSpaces, partitions } from "@/lib/db";
import { asc, count, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";
import { describeDbError, isUniqueViolation } from "@/lib/db/errors";
import { chatWebhookProblem, chatWebhookProblemText } from "@/lib/google-chat";
import { maskWebhookUrl } from "@/lib/record-chat-alert/rules";

/** 웹훅 주소는 비밀값이라 응답에 싣지 않는다 — 가린 표시와 쓰는 파티션 수만 */
export async function GET(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    try {
        const rows = await db
            .select({
                id: chatSpaces.id,
                name: chatSpaces.name,
                webhookUrl: chatSpaces.webhookUrl,
                createdAt: chatSpaces.createdAt,
                partitionCount: count(partitions.id),
            })
            .from(chatSpaces)
            .leftJoin(partitions, eq(partitions.chatSpaceId, chatSpaces.id))
            .where(eq(chatSpaces.orgId, auth.user.orgId))
            .groupBy(chatSpaces.id)
            .orderBy(asc(chatSpaces.name));

        return NextResponse.json({
            success: true,
            data: rows.map(({ webhookUrl, ...r }) => ({ ...r, webhookHint: maskWebhookUrl(webhookUrl) })),
        });
    } catch (error) {
        console.error("Chat spaces fetch error:", describeDbError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const { name, webhookUrl } = await req.json();
    const trimmedName = typeof name === "string" ? name.trim() : "";
    const trimmedUrl = typeof webhookUrl === "string" ? webhookUrl.trim() : "";
    if (!trimmedName) {
        return NextResponse.json({ success: false, error: "스페이스 이름을 입력해주세요." }, { status: 400 });
    }
    const problem = chatWebhookProblem(trimmedUrl);
    if (problem) {
        return NextResponse.json({ success: false, error: chatWebhookProblemText(problem) }, { status: 400 });
    }

    try {
        const [created] = await db
            .insert(chatSpaces)
            .values({ orgId: auth.user.orgId, name: trimmedName, webhookUrl: trimmedUrl, createdBy: auth.user.userId })
            .returning({ id: chatSpaces.id, name: chatSpaces.name });
        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        if (isUniqueViolation(error)) {
            return NextResponse.json({ success: false, error: "같은 이름의 스페이스가 이미 있습니다." }, { status: 409 });
        }
        console.error("Chat space create error:", describeDbError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
