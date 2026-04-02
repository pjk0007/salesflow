import { NextRequest, NextResponse } from "next/server";
import { db, records, memos, users } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

// GET: 메모 목록 조회
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    // 레코드 소유 검증
    const [record] = await db
        .select({ id: records.id })
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

    if (!record) {
        return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
    }

    const result = await db
        .select({
            id: memos.id,
            content: memos.content,
            createdAt: memos.createdAt,
            createdBy: memos.createdBy,
            userName: users.name,
        })
        .from(memos)
        .leftJoin(users, eq(memos.createdBy, users.id))
        .where(eq(memos.recordId, recordId))
        .orderBy(desc(memos.createdAt));

    return NextResponse.json({ success: true, data: result });
}

// POST: 메모 추가
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    const { content } = await req.json();
    if (!content || typeof content !== "string" || !content.trim()) {
        return NextResponse.json({ success: false, error: "메모 내용을 입력해주세요." }, { status: 400 });
    }

    // 레코드 소유 검증
    const [record] = await db
        .select({ id: records.id })
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

    if (!record) {
        return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
    }

    const [newMemo] = await db
        .insert(memos)
        .values({
            recordId,
            content: content.trim(),
            createdBy: user.userId,
        })
        .returning();

    return NextResponse.json({ success: true, data: newMemo });
}
