import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplates } from "@/lib/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

/** NHN categoryId → 로컬 email_categories.id 변환 (없으면 null) */
async function resolveLocalCategoryId(nhnCategoryId: number | null | undefined, orgId: string): Promise<number | null> {
    if (!nhnCategoryId) return null;
    const rows = await db.execute(
        sql`SELECT id FROM email_categories WHERE nhn_category_id = ${nhnCategoryId} AND org_id = ${orgId} LIMIT 1`
    ) as { id: number }[];
    return rows[0]?.id ?? null;
}

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const searchParams = req.nextUrl.searchParams;
        const page = Number(searchParams.get("page")) || 1;
        const pageSize = Math.min(Number(searchParams.get("pageSize")) || 20, 100);
        const offset = (page - 1) * pageSize;
        const statusFilter = searchParams.get("status") || undefined;

        const whereClause = statusFilter
            ? and(eq(emailTemplates.orgId, user.orgId), eq(emailTemplates.status, statusFilter))
            : eq(emailTemplates.orgId, user.orgId);

        const [countResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(emailTemplates)
            .where(whereClause);

        const templates = await db
            .select()
            .from(emailTemplates)
            .where(whereClause)
            .orderBy(desc(emailTemplates.createdAt))
            .limit(pageSize)
            .offset(offset);

        return NextResponse.json({
            success: true,
            data: templates,
            totalCount: Number(countResult.count),
        });
    } catch (error) {
        console.error("Email templates fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { name, subject, htmlBody, templateType, status, categoryId } = await req.json();
        if (status !== "draft" && (!name || !subject || !htmlBody)) {
            return NextResponse.json({ success: false, error: "name, subject, htmlBody는 필수입니다." }, { status: 400 });
        }

        const localCategoryId = await resolveLocalCategoryId(categoryId, user.orgId);

        const [created] = await db
            .insert(emailTemplates)
            .values({
                orgId: user.orgId,
                name: name || "",
                subject: subject || "",
                htmlBody: htmlBody || "",
                templateType: templateType || null,
                categoryId: localCategoryId,
                status: status || "published",
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Email template create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
