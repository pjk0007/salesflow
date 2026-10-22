import { NextRequest, NextResponse } from "next/server";
import { db, chatSpaces } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";
import { describeDbError, isUniqueViolation } from "@/lib/db/errors";
import { chatWebhookProblem, chatWebhookProblemText } from "@/lib/google-chat";

/** 이름·웹훅 주소 변경. 주소는 보낼 때만 바꾼다 (빈 값이면 그대로) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const spaceId = Number((await params).id);
    if (!Number.isSafeInteger(spaceId) || spaceId <= 0) {
        return NextResponse.json({ success: false, error: "잘못된 스페이스 ID입니다." }, { status: 400 });
    }
    const { name, webhookUrl } = await req.json();
    const updateData: { name?: string; webhookUrl?: string; updatedAt: Date } = { updatedAt: new Date() };
    if (name !== undefined) {
        const trimmed = typeof name === "string" ? name.trim() : "";
        if (!trimmed) {
            return NextResponse.json({ success: false, error: "스페이스 이름을 입력해주세요." }, { status: 400 });
        }
        updateData.name = trimmed;
    }
    if (typeof webhookUrl === "string" && webhookUrl.trim()) {
        const problem = chatWebhookProblem(webhookUrl.trim());
        if (problem) {
            return NextResponse.json({ success: false, error: chatWebhookProblemText(problem) }, { status: 400 });
        }
        updateData.webhookUrl = webhookUrl.trim();
    }

    try {
        const [updated] = await db
            .update(chatSpaces)
            .set(updateData)
            .where(and(eq(chatSpaces.id, spaceId), eq(chatSpaces.orgId, auth.user.orgId)))
            .returning({ id: chatSpaces.id, name: chatSpaces.name });
        if (!updated) {
            return NextResponse.json({ success: false, error: "스페이스를 찾을 수 없습니다." }, { status: 404 });
        }
        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        if (isUniqueViolation(error)) {
            return NextResponse.json({ success: false, error: "같은 이름의 스페이스가 이미 있습니다." }, { status: 409 });
        }
        console.error("Chat space update error:", describeDbError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

/** 삭제하면 이 스페이스를 고른 파티션의 알림은 꺼진다 (FK ON DELETE SET NULL) */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const spaceId = Number((await params).id);
    if (!Number.isSafeInteger(spaceId) || spaceId <= 0) {
        return NextResponse.json({ success: false, error: "잘못된 스페이스 ID입니다." }, { status: 400 });
    }
    try {
        const [deleted] = await db
            .delete(chatSpaces)
            .where(and(eq(chatSpaces.id, spaceId), eq(chatSpaces.orgId, auth.user.orgId)))
            .returning({ id: chatSpaces.id });
        if (!deleted) {
            return NextResponse.json({ success: false, error: "스페이스를 찾을 수 없습니다." }, { status: 404 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Chat space delete error:", describeDbError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
