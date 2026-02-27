import { NextRequest, NextResponse } from "next/server";
import { db, workspaces } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const result = await db
            .select({
                id: workspaces.id,
                name: workspaces.name,
                description: workspaces.description,
                icon: workspaces.icon,
            })
            .from(workspaces)
            .where(eq(workspaces.orgId, user.orgId))
            .orderBy(workspaces.createdAt);

        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("Workspaces fetch error:", error);
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

    const { name, description, icon } = await req.json();

    if (!name || !name.trim()) {
        return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
    }

    try {
        // 플랜 제한 체크
        const currentCount = await getResourceCount(user.orgId, "workspaces");
        const limit = await checkPlanLimit(user.orgId, "workspaces", currentCount);
        if (!limit.allowed) {
            return NextResponse.json({
                success: false,
                error: `워크스페이스 한도(${limit.limit}개)를 초과했습니다. 플랜 업그레이드가 필요합니다.`,
                upgradeRequired: true,
            }, { status: 403 });
        }

        const [created] = await db
            .insert(workspaces)
            .values({
                orgId: user.orgId,
                name: name.trim(),
                description: description?.trim() || null,
                icon: icon?.trim() || null,
            })
            .returning({
                id: workspaces.id,
                name: workspaces.name,
                description: workspaces.description,
                icon: workspaces.icon,
            });

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Workspace create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
