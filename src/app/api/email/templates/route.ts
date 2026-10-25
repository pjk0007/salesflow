import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplates } from "@/lib/db";
import { eq, and, desc, sql, ilike, or, inArray, isNull, type SQL } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";


export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const searchParams = req.nextUrl.searchParams;
        const requestedPage = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
        const sizeParam = Math.floor(Number(searchParams.get("pageSize")));
        const pageSize = sizeParam > 0 ? Math.min(sizeParam, 100) : 20;
        const statusFilter = searchParams.get("status") || undefined;
        const q = searchParams.get("q")?.trim();
        const categoryParam = searchParams.get("categoryId");
        // 선택칸에 이미 연결된 템플릿을 보이기 위한 id 조회 (목록 밖·초안이어도)
        const ids = (searchParams.get("ids") ?? "")
            .split(",")
            .map((v) => Number(v))
            .filter((v) => Number.isInteger(v) && v > 0)
            .slice(0, 100);

        const conditions: SQL[] = [eq(emailTemplates.orgId, user.orgId)];
        if (ids.length > 0) conditions.push(inArray(emailTemplates.id, ids));
        if (statusFilter) conditions.push(eq(emailTemplates.status, statusFilter));
        if (q) conditions.push(or(ilike(emailTemplates.name, `%${q}%`), ilike(emailTemplates.subject, `%${q}%`))!);
        if (categoryParam === "none") conditions.push(isNull(emailTemplates.categoryId));
        else if (categoryParam && Number(categoryParam) > 0) conditions.push(eq(emailTemplates.categoryId, Number(categoryParam)));
        const whereClause = and(...conditions);

        const [countResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(emailTemplates)
            .where(whereClause);
        const total = Number(countResult.count);
        const totalPages = Math.ceil(total / pageSize);
        // 마지막 페이지를 넘는 요청(삭제 직후 등)은 마지막 유효 페이지를 돌려주고 화면이 그 값으로 맞춘다
        const page = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;

        const templates = await db
            .select()
            .from(emailTemplates)
            .where(whereClause)
            .orderBy(desc(emailTemplates.createdAt), desc(emailTemplates.id))
            .limit(pageSize)
            .offset((page - 1) * pageSize);

        return NextResponse.json({
            success: true,
            data: templates,
            totalCount: total,
            total,
            page,
            pageSize,
            totalPages,
        });
    } catch (error) {
        console.error("Email templates fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { name, subject, htmlBody, templateType, status, categoryId, useUnsubscribe } = await req.json();
        if (status !== "draft" && (!name || !subject || !htmlBody)) {
            return NextResponse.json({ success: false, error: "name, subject, htmlBody는 필수입니다." }, { status: 400 });
        }

        const [created] = await db
            .insert(emailTemplates)
            .values({
                orgId: user.orgId,
                name: name || "",
                subject: subject || "",
                htmlBody: htmlBody || "",
                templateType: templateType || null,
                categoryId: categoryId || null,
                status: status || "published",
                useUnsubscribe: useUnsubscribe ? 1 : 0,
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Email template create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
