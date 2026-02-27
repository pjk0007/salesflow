import { NextRequest, NextResponse } from "next/server";
import { db, products } from "@/lib/db";
import { eq, and, or, ilike, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const search = req.nextUrl.searchParams.get("search");
    const category = req.nextUrl.searchParams.get("category");
    const activeOnly = req.nextUrl.searchParams.get("activeOnly");

    try {
        const conditions = [eq(products.orgId, user.orgId)];

        if (activeOnly === "true") {
            conditions.push(eq(products.isActive, 1));
        }

        if (category) {
            conditions.push(eq(products.category, category));
        }

        if (search) {
            const pattern = `%${search}%`;
            conditions.push(
                or(
                    ilike(products.name, pattern),
                    ilike(products.summary, pattern),
                    ilike(products.category, pattern),
                )!
            );
        }

        const result = await db
            .select()
            .from(products)
            .where(and(...conditions))
            .orderBy(products.sortOrder, desc(products.createdAt));

        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("Products fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { name, summary, description, category, price, url, imageUrl } = await req.json();

    if (!name || !name.trim()) {
        return NextResponse.json({ success: false, error: "제품명을 입력해주세요." }, { status: 400 });
    }

    try {
        const [created] = await db
            .insert(products)
            .values({
                orgId: user.orgId,
                name: name.trim(),
                summary: summary?.trim() || null,
                description: description?.trim() || null,
                category: category?.trim() || null,
                price: price?.trim() || null,
                url: url?.trim() || null,
                imageUrl: imageUrl?.trim() || null,
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Product create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
