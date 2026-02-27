import { NextRequest, NextResponse } from "next/server";
import { db, products } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    const { name, summary, description, category, price, url, imageUrl, isActive, sortOrder } = await req.json();

    try {
        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (name !== undefined) updateData.name = name.trim();
        if (summary !== undefined) updateData.summary = summary?.trim() || null;
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (category !== undefined) updateData.category = category?.trim() || null;
        if (price !== undefined) updateData.price = price?.trim() || null;
        if (url !== undefined) updateData.url = url?.trim() || null;
        if (imageUrl !== undefined) updateData.imageUrl = imageUrl?.trim() || null;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

        const [updated] = await db
            .update(products)
            .set(updateData)
            .where(and(eq(products.id, id), eq(products.orgId, user.orgId)))
            .returning();

        if (!updated) {
            return NextResponse.json({ success: false, error: "제품을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Product update error:", error);
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

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    try {
        const [deleted] = await db
            .delete(products)
            .where(and(eq(products.id, id), eq(products.orgId, user.orgId)))
            .returning({ id: products.id });

        if (!deleted) {
            return NextResponse.json({ success: false, error: "제품을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Product delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
