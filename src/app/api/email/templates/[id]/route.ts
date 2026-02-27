import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplates } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    try {
        const [template] = await db
            .select()
            .from(emailTemplates)
            .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId)))
            .limit(1);

        if (!template) {
            return NextResponse.json({ success: false, error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: template });
    } catch (error) {
        console.error("Email template fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    try {
        const { name, subject, htmlBody, templateType, isActive, status, categoryId } = await req.json();

        // 발행 시 필수 필드 검증
        if (status === "published") {
            const [current] = await db.select().from(emailTemplates)
                .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId))).limit(1);
            if (!current) return NextResponse.json({ success: false, error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
            const finalName = name ?? current.name;
            const finalSubject = subject ?? current.subject;
            const finalHtmlBody = htmlBody ?? current.htmlBody;
            if (!finalName || !finalSubject || !finalHtmlBody) {
                return NextResponse.json({ success: false, error: "발행하려면 이름, 제목, 본문이 모두 필요합니다." }, { status: 400 });
            }
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (name !== undefined) updateData.name = name;
        if (subject !== undefined) updateData.subject = subject;
        if (htmlBody !== undefined) updateData.htmlBody = htmlBody;
        if (templateType !== undefined) updateData.templateType = templateType;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (status !== undefined) updateData.status = status;
        if (categoryId !== undefined) updateData.categoryId = categoryId;

        const [updated] = await db
            .update(emailTemplates)
            .set(updateData)
            .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId)))
            .returning();

        if (!updated) {
            return NextResponse.json({ success: false, error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Email template update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    try {
        const [deleted] = await db
            .delete(emailTemplates)
            .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId)))
            .returning({ id: emailTemplates.id });

        if (!deleted) {
            return NextResponse.json({ success: false, error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Email template delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
