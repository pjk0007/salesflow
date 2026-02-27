import { NextRequest, NextResponse } from "next/server";
import { db, webForms, webFormFields } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
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
    const formId = Number(idStr);
    if (!formId) {
        return NextResponse.json({ success: false, error: "폼 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [form] = await db
            .select()
            .from(webForms)
            .where(and(eq(webForms.id, formId), eq(webForms.orgId, user.orgId)));

        if (!form) {
            return NextResponse.json({ success: false, error: "폼을 찾을 수 없습니다." }, { status: 404 });
        }

        const fields = await db
            .select()
            .from(webFormFields)
            .where(eq(webFormFields.formId, formId))
            .orderBy(asc(webFormFields.sortOrder));

        return NextResponse.json({ success: true, data: { ...form, fields } });
    } catch (error) {
        console.error("Web form fetch error:", error);
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
    const formId = Number(idStr);
    if (!formId) {
        return NextResponse.json({ success: false, error: "폼 ID가 필요합니다." }, { status: 400 });
    }

    const {
        name, title, description,
        completionTitle, completionMessage,
        completionButtonText, completionButtonUrl,
        defaultValues, isActive,
        fields,
    } = await req.json();

    try {
        const [existing] = await db
            .select()
            .from(webForms)
            .where(and(eq(webForms.id, formId), eq(webForms.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "폼을 찾을 수 없습니다." }, { status: 404 });
        }

        // 폼 메타데이터 업데이트
        const [updated] = await db
            .update(webForms)
            .set({
                ...(name !== undefined && { name }),
                ...(title !== undefined && { title }),
                ...(description !== undefined && { description }),
                ...(completionTitle !== undefined && { completionTitle }),
                ...(completionMessage !== undefined && { completionMessage }),
                ...(completionButtonText !== undefined && { completionButtonText }),
                ...(completionButtonUrl !== undefined && { completionButtonUrl }),
                ...(defaultValues !== undefined && { defaultValues }),
                ...(isActive !== undefined && { isActive }),
                updatedAt: new Date(),
            })
            .where(eq(webForms.id, formId))
            .returning();

        // 필드 일괄 업데이트 (있으면)
        if (Array.isArray(fields)) {
            // 기존 필드 삭제 후 새로 삽입
            await db.delete(webFormFields).where(eq(webFormFields.formId, formId));

            if (fields.length > 0) {
                await db.insert(webFormFields).values(
                    fields.map((f: any, idx: number) => ({
                        formId,
                        label: f.label,
                        description: f.description || null,
                        placeholder: f.placeholder || null,
                        fieldType: f.fieldType || "text",
                        linkedFieldKey: f.linkedFieldKey || null,
                        isRequired: f.isRequired ? 1 : 0,
                        options: f.options || null,
                        sortOrder: idx,
                    }))
                );
            }
        }

        // 업데이트된 필드 목록 반환
        const updatedFields = await db
            .select()
            .from(webFormFields)
            .where(eq(webFormFields.formId, formId))
            .orderBy(asc(webFormFields.sortOrder));

        return NextResponse.json({
            success: true,
            data: { ...updated, fields: updatedFields },
        });
    } catch (error) {
        console.error("Web form update error:", error);
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
    const formId = Number(idStr);
    if (!formId) {
        return NextResponse.json({ success: false, error: "폼 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [existing] = await db
            .select({ id: webForms.id })
            .from(webForms)
            .where(and(eq(webForms.id, formId), eq(webForms.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "폼을 찾을 수 없습니다." }, { status: 404 });
        }

        await db.delete(webForms).where(eq(webForms.id, formId));

        return NextResponse.json({ success: true, message: "폼이 삭제되었습니다." });
    } catch (error) {
        console.error("Web form delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
