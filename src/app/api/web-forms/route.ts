import { NextRequest, NextResponse } from "next/server";
import { db, webForms, webFormFields } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { nanoid } from "nanoid";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const workspaceIdStr = req.nextUrl.searchParams.get("workspaceId");
        const workspaceId = workspaceIdStr ? Number(workspaceIdStr) : undefined;

        const conditions = [eq(webForms.orgId, user.orgId)];
        if (workspaceId) {
            conditions.push(eq(webForms.workspaceId, workspaceId));
        }

        const forms = await db
            .select()
            .from(webForms)
            .where(and(...conditions))
            .orderBy(webForms.createdAt);

        // 각 폼의 필드 수 집계
        const fieldCounts = await db
            .select({ formId: webFormFields.formId, value: count() })
            .from(webFormFields)
            .groupBy(webFormFields.formId);

        const countMap = new Map(fieldCounts.map((fc) => [fc.formId, fc.value]));

        const data = forms.map((f) => ({
            ...f,
            fieldCount: countMap.get(f.id) ?? 0,
        }));

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Web forms fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { name, workspaceId, partitionId, title, description } = await req.json();
    if (!name || !workspaceId || !partitionId || !title) {
        return NextResponse.json({ success: false, error: "필수 항목이 누락되었습니다." }, { status: 400 });
    }

    try {
        const slug = nanoid(8);

        const [form] = await db
            .insert(webForms)
            .values({
                orgId: user.orgId,
                workspaceId,
                partitionId,
                name,
                slug,
                title,
                description: description || null,
                createdBy: user.userId,
            })
            .returning();

        return NextResponse.json({ success: true, data: form }, { status: 201 });
    } catch (error) {
        console.error("Web form create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
