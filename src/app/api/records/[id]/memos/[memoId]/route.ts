import { NextRequest, NextResponse } from "next/server";
import { db, records, memos } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

// DELETE: 메모 삭제
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string; memoId: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id, memoId } = await params;
    const recordId = Number(id);
    const memoIdNum = Number(memoId);

    if (!recordId || !memoIdNum) {
        return NextResponse.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 });
    }

    // 레코드 소유 검증
    const [record] = await db
        .select({ id: records.id })
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

    if (!record) {
        return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
    }

    // 메모 삭제
    const [deleted] = await db
        .delete(memos)
        .where(and(eq(memos.id, memoIdNum), eq(memos.recordId, recordId)))
        .returning({ id: memos.id });

    if (!deleted) {
        return NextResponse.json({ success: false, error: "메모를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
