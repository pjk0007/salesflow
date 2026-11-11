import { NextRequest, NextResponse } from "next/server";
import { db, records, memos, users } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { parseMemoInput } from "@/lib/leads/memo-input";

// GET: 메모 목록 조회
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
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
            kind: memos.kind,
            attachments: memos.attachments,
            nextContactAt: memos.nextContactAt,
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
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    const body = await req.json();
    const parsed = parseMemoInput(body);
    if (!parsed.ok) {
        return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }
    const { content, kind, attachments, nextContactAt } = parsed.value;

    // 레코드 소유 검증
    const [record] = await db
        .select({ id: records.id, data: records.data })
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

    if (!record) {
        return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
    }

    const newMemo = await db.transaction(async (tx) => {
        const [created] = await tx
            .insert(memos)
            .values({ recordId, content, kind, attachments, nextContactAt, createdBy: user.userId })
            .returning();
        // 다음 연락일을 정하면 리드의 "다음연락일" 칸도 맞춘다 (중요 탭 기준)
        if (nextContactAt) {
            await tx
                .update(records)
                .set({
                    data: { ...(record.data as Record<string, unknown>), nextContactAt: nextContactAt.toISOString() },
                    updatedAt: new Date(),
                })
                .where(eq(records.id, recordId));
        }
        return created;
    });

    return NextResponse.json({ success: true, data: newMemo });
}
