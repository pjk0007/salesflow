import { NextRequest, NextResponse } from "next/server";
import { db, fieldTypes } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const types = await db
        .select()
        .from(fieldTypes)
        .where(eq(fieldTypes.orgId, user.orgId))
        .orderBy(fieldTypes.name);

    return NextResponse.json({ success: true, data: types });
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { name, description, icon } = await req.json();
    if (!name?.trim()) {
        return NextResponse.json({ success: false, error: "타입 이름을 입력해주세요." }, { status: 400 });
    }

    try {
        const [created] = await db
            .insert(fieldTypes)
            .values({
                orgId: user.orgId,
                name: name.trim(),
                description: description?.trim() || null,
                icon: icon || null,
            })
            .returning({ id: fieldTypes.id, name: fieldTypes.name });

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes("unique")) {
            return NextResponse.json({ success: false, error: "이미 존재하는 타입 이름입니다." }, { status: 409 });
        }
        console.error("Field type create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
