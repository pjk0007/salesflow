import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient } from "@/lib/nhn-email";

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const categoryId = Number(id);
    if (!categoryId) {
        return NextResponse.json({ success: false, error: "유효하지 않은 카테고리 ID입니다." }, { status: 400 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 없습니다." }, { status: 400 });
    }

    try {
        const { categoryName, categoryDesc } = await req.json();

        const result = await client.updateCategory(categoryId, {
            categoryName: categoryName || undefined,
            categoryDesc: categoryDesc !== undefined ? categoryDesc : undefined,
        });

        if (!result.header.isSuccessful) {
            return NextResponse.json({
                success: false,
                error: result.header.resultMessage || "카테고리 수정에 실패했습니다.",
            }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Email category update error:", error);
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

    const { id } = await params;
    const categoryId = Number(id);
    if (!categoryId) {
        return NextResponse.json({ success: false, error: "유효하지 않은 카테고리 ID입니다." }, { status: 400 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 없습니다." }, { status: 400 });
    }

    try {
        const result = await client.deleteCategory(categoryId);

        if (!result.header.isSuccessful) {
            return NextResponse.json({
                success: false,
                error: result.header.resultMessage || "카테고리 삭제에 실패했습니다.",
            }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Email category delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
