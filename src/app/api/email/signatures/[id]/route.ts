import { NextRequest, NextResponse } from "next/server";
import { db, emailSignatures } from "@/lib/db";
import { eq, and, ne } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const sigId = parseInt(id);
        const { name, signature, isDefault } = await req.json();

        const [existing] = await db
            .select()
            .from(emailSignatures)
            .where(and(
                eq(emailSignatures.id, sigId),
                eq(emailSignatures.orgId, user.orgId)
            ));

        if (!existing) {
            return NextResponse.json({ success: false, error: "서명을 찾을 수 없습니다." }, { status: 404 });
        }

        // 기본 서명으로 설정 시 다른 것들 해제
        if (isDefault) {
            await db
                .update(emailSignatures)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(and(
                    eq(emailSignatures.orgId, user.orgId),
                    ne(emailSignatures.id, sigId)
                ));
        }

        const sigValue = signature !== undefined
            ? (typeof signature === "string" ? signature : JSON.stringify(signature))
            : undefined;

        const [updated] = await db
            .update(emailSignatures)
            .set({
                ...(name !== undefined && { name: name.trim() }),
                ...(sigValue !== undefined && { signature: sigValue }),
                ...(isDefault !== undefined && { isDefault }),
                updatedAt: new Date(),
            })
            .where(eq(emailSignatures.id, sigId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Signature update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const sigId = parseInt(id);

        const [existing] = await db
            .select()
            .from(emailSignatures)
            .where(and(
                eq(emailSignatures.id, sigId),
                eq(emailSignatures.orgId, user.orgId)
            ));

        if (!existing) {
            return NextResponse.json({ success: false, error: "서명을 찾을 수 없습니다." }, { status: 404 });
        }

        await db.delete(emailSignatures).where(eq(emailSignatures.id, sigId));

        // 삭제한 게 기본이었으면 남은 첫 번째를 기본으로
        if (existing.isDefault) {
            const [first] = await db
                .select({ id: emailSignatures.id })
                .from(emailSignatures)
                .where(eq(emailSignatures.orgId, user.orgId))
                .orderBy(emailSignatures.createdAt)
                .limit(1);

            if (first) {
                await db
                    .update(emailSignatures)
                    .set({ isDefault: true, updatedAt: new Date() })
                    .where(eq(emailSignatures.id, first.id));
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Signature delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
