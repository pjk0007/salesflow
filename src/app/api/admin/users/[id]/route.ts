import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, users } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user?.isSuperAdmin) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const { id: targetId } = await params;
    const body = await req.json();

    const [target] = await db.select().from(users).where(eq(users.id, targetId));
    if (!target) {
        return NextResponse.json({ success: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    // 자기 자신의 super admin 해제 방지
    if (targetId === user.userId && body.isSuperAdmin === 0) {
        return NextResponse.json({ success: false, error: "자신의 super admin 권한은 해제할 수 없습니다." }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.isActive === "number") updates.isActive = body.isActive;
    if (typeof body.isSuperAdmin === "number") updates.isSuperAdmin = body.isSuperAdmin;

    await db.update(users).set(updates).where(eq(users.id, targetId));

    return NextResponse.json({ success: true });
}
