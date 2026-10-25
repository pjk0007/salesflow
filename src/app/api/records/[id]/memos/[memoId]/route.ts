import { NextRequest, NextResponse } from "next/server";
import { db, memos } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requireRecordAccess } from "@/lib/partition-access";
import { canDeleteMemo, MEMO_DELETE_FORBIDDEN } from "@/lib/memo-permissions";

// DELETE: 메모 삭제
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string; memoId: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id, memoId } = await params;
    const recordId = Number(id);
    const memoIdNum = Number(memoId);

    if (!recordId || !memoIdNum) {
        return NextResponse.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 });
    }

    // 레코드 소유·파티션 접근 검증
    const access = await requireRecordAccess(user, recordId, "read");
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const [memo] = await db
        .select({ id: memos.id, createdBy: memos.createdBy })
        .from(memos)
        .where(and(eq(memos.id, memoIdNum), eq(memos.recordId, recordId)));
    if (!memo) {
        return NextResponse.json({ success: false, error: "메모를 찾을 수 없습니다." }, { status: 404 });
    }
    // 동료의 상담 기록을 실수로 지우지 않도록 작성자 본인 또는 관리자만
    if (!canDeleteMemo(memo, user)) {
        return NextResponse.json({ success: false, error: MEMO_DELETE_FORBIDDEN }, { status: 403 });
    }

    const [deleted] = await db
        .delete(memos)
        .where(and(eq(memos.id, memoIdNum), eq(memos.recordId, recordId)))
        .returning({ id: memos.id });

    if (!deleted) {
        return NextResponse.json({ success: false, error: "메모를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
