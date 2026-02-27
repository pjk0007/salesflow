import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient } from "@/lib/nhn-email";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 없습니다." }, { status: 400 });
    }

    try {
        const result = await client.listCategories();
        if (!result.header.isSuccessful || !result.data) {
            return NextResponse.json({
                success: false,
                error: result.header.resultMessage || "카테고리 조회에 실패했습니다.",
            }, { status: 500 });
        }

        const categories = result.data.map((cat) => ({
            categoryId: cat.categoryId,
            categoryName: cat.categoryName,
            categoryDesc: cat.categoryDesc,
        }));

        return NextResponse.json({ success: true, data: categories });
    } catch (error) {
        console.error("Email categories fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 없습니다." }, { status: 400 });
    }

    try {
        const { categoryName, categoryDesc } = await req.json();
        if (!categoryName) {
            return NextResponse.json({ success: false, error: "카테고리 이름은 필수입니다." }, { status: 400 });
        }

        const result = await client.createCategory({
            categoryName,
            categoryDesc: categoryDesc || undefined,
        });

        if (!result.header.isSuccessful) {
            return NextResponse.json({
                success: false,
                error: result.header.resultMessage || "카테고리 생성에 실패했습니다.",
            }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            data: { categoryId: result.data?.categoryId },
        }, { status: 201 });
    } catch (error) {
        console.error("Email category create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
