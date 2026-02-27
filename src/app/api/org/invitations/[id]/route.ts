import { NextRequest, NextResponse } from "next/server";
import { db, organizationInvitations } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

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

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (isNaN(id)) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    try {
        const [invitation] = await db
            .select({ id: organizationInvitations.id })
            .from(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.id, id),
                    eq(organizationInvitations.orgId, user.orgId)
                )
            );

        if (!invitation) {
            return NextResponse.json({ success: false, error: "초대를 찾을 수 없습니다." }, { status: 404 });
        }

        await db
            .update(organizationInvitations)
            .set({ status: "cancelled" })
            .where(eq(organizationInvitations.id, id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Invitation cancel error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
