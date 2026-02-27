import { NextRequest, NextResponse } from "next/server";
import { db, organizationInvitations, users, organizationMembers } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";
import crypto from "crypto";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        const invitations = await db
            .select({
                id: organizationInvitations.id,
                email: organizationInvitations.email,
                role: organizationInvitations.role,
                status: organizationInvitations.status,
                token: organizationInvitations.token,
                invitedById: organizationInvitations.invitedBy,
                expiresAt: organizationInvitations.expiresAt,
                createdAt: organizationInvitations.createdAt,
            })
            .from(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.orgId, user.orgId),
                    eq(organizationInvitations.status, "pending"),
                    gt(organizationInvitations.expiresAt, new Date())
                )
            );

        // invitedBy 정보 가져오기
        const inviterMap = new Map<string, string>();
        for (const inv of invitations) {
            if (!inviterMap.has(inv.invitedById)) {
                const [inviter] = await db
                    .select({ id: users.id, name: users.name })
                    .from(users)
                    .where(eq(users.id, inv.invitedById));
                if (inviter) inviterMap.set(inviter.id, inviter.name);
            }
        }

        const data = invitations.map((inv) => ({
            id: inv.id,
            email: inv.email,
            role: inv.role,
            status: inv.status,
            token: inv.token,
            invitedBy: {
                id: inv.invitedById,
                name: inviterMap.get(inv.invitedById) ?? "",
            },
            expiresAt: inv.expiresAt,
            createdAt: inv.createdAt,
        }));

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Invitations fetch error:", error);
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

    try {
        const { email, role } = await req.json();

        if (!email || typeof email !== "string" || !email.includes("@")) {
            return NextResponse.json({ success: false, error: "유효한 이메일을 입력해주세요." }, { status: 400 });
        }

        if (!role || !["admin", "member"].includes(role)) {
            return NextResponse.json({ success: false, error: "유효하지 않은 역할입니다." }, { status: 400 });
        }

        // admin 역할 초대는 owner만
        if (role === "admin" && user.role !== "owner") {
            return NextResponse.json({ success: false, error: "관리자 초대는 소유자만 가능합니다." }, { status: 403 });
        }

        // 플랜 제한 체크
        const currentCount = await getResourceCount(user.orgId, "members");
        const limit = await checkPlanLimit(user.orgId, "members", currentCount);
        if (!limit.allowed) {
            return NextResponse.json({
                success: false,
                error: `멤버 한도(${limit.limit}명)를 초과했습니다. 플랜 업그레이드가 필요합니다.`,
                upgradeRequired: true,
            }, { status: 403 });
        }

        // 이미 조직에 소속된 이메일 체크 (organizationMembers 기반)
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .innerJoin(organizationMembers, and(
                eq(organizationMembers.userId, users.id),
                eq(organizationMembers.organizationId, user.orgId)
            ))
            .where(eq(users.email, email.toLowerCase()));

        if (existingUser) {
            return NextResponse.json({ success: false, error: "이미 조직에 소속된 이메일입니다." }, { status: 400 });
        }

        // 이미 대기 중인 초대 체크
        const [existingInvitation] = await db
            .select({ id: organizationInvitations.id })
            .from(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.orgId, user.orgId),
                    eq(organizationInvitations.email, email.toLowerCase()),
                    eq(organizationInvitations.status, "pending"),
                    gt(organizationInvitations.expiresAt, new Date())
                )
            );

        if (existingInvitation) {
            return NextResponse.json({ success: false, error: "이미 대기 중인 초대가 있습니다." }, { status: 400 });
        }

        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

        const [invitation] = await db
            .insert(organizationInvitations)
            .values({
                orgId: user.orgId,
                email: email.toLowerCase(),
                role,
                token,
                invitedBy: user.userId,
                expiresAt,
            })
            .returning();

        return NextResponse.json({
            success: true,
            data: {
                id: invitation.id,
                email: invitation.email,
                role: invitation.role,
                token: invitation.token,
                expiresAt: invitation.expiresAt,
            },
        }, { status: 201 });
    } catch (error) {
        console.error("Invitation create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
