import { NextRequest, NextResponse } from "next/server";
import { db, emailSignatures } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const signatures = await db
            .select()
            .from(emailSignatures)
            .where(eq(emailSignatures.orgId, user.orgId))
            .orderBy(emailSignatures.createdAt);

        return NextResponse.json({ success: true, data: signatures });
    } catch (error) {
        console.error("Signatures fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { name, signature } = await req.json();
        if (!name || !signature) {
            return NextResponse.json({ success: false, error: "이름과 서명 내용은 필수입니다." }, { status: 400 });
        }

        // 첫 서명이면 isDefault=true
        const existing = await db
            .select({ id: emailSignatures.id })
            .from(emailSignatures)
            .where(eq(emailSignatures.orgId, user.orgId))
            .limit(1);

        const isDefault = existing.length === 0;

        const [created] = await db
            .insert(emailSignatures)
            .values({
                orgId: user.orgId,
                name: name.trim(),
                signature: typeof signature === "string" ? signature : JSON.stringify(signature),
                isDefault,
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Signature create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
