import { NextRequest, NextResponse } from "next/server";
import { db, organizationInvitations, organizations, users, organizationMembers, emailSenderProfiles } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";
import { getEmailClient, getEmailConfig } from "@/lib/nhn-email";
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

        // 초대 이메일 발송 (실패해도 초대 자체는 성공)
        let emailSent = false;
        try {
            const emailClient = await getEmailClient(user.orgId);
            const emailConfig = await getEmailConfig(user.orgId);
            if (emailClient && emailConfig) {
                const [org] = await db
                    .select({ name: organizations.name })
                    .from(organizations)
                    .where(eq(organizations.id, user.orgId));

                const orgName = org?.name || "SalesFlow";
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
                const inviteUrl = `${baseUrl}/invite?token=${token}`;

                // 기본 발신자 프로필 → 레거시 fallback
                let senderAddress = emailConfig.fromEmail || "";
                let senderName = emailConfig.fromName || orgName;
                const [defaultProfile] = await db
                    .select()
                    .from(emailSenderProfiles)
                    .where(and(eq(emailSenderProfiles.orgId, user.orgId), eq(emailSenderProfiles.isDefault, true)))
                    .limit(1);
                if (defaultProfile) {
                    senderAddress = defaultProfile.fromEmail;
                    senderName = defaultProfile.fromName;
                }

                await emailClient.sendEachMail({
                    senderAddress,
                    senderName,
                    title: `[SalesFlow] ${orgName} 팀에 초대되었습니다`,
                    body: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
  <h2 style="margin: 0 0 16px; color: #111;">${orgName} 팀 초대</h2>
  <p style="color: #444; line-height: 1.7; margin: 0 0 8px;">안녕하세요,</p>
  <p style="color: #444; line-height: 1.7; margin: 0 0 24px;"><b>${user.name}</b>님이 <b>${orgName}</b> 팀의 ${role === "admin" ? "관리자" : "멤버"}로 초대했습니다.</p>
  <a href="${inviteUrl}" style="display: inline-block; background: #111; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 500;">초대 수락하기</a>
  <p style="color: #888; font-size: 13px; margin: 24px 0 0;">이 초대는 7일 후 만료됩니다.</p>
</div>`,
                    receiverList: [{ receiveMailAddr: email.toLowerCase(), receiveType: "MRT0" }],
                });
                emailSent = true;
            }
        } catch (e) {
            console.error("Invitation email send error:", e);
        }

        return NextResponse.json({
            success: true,
            data: {
                id: invitation.id,
                email: invitation.email,
                role: invitation.role,
                token: invitation.token,
                expiresAt: invitation.expiresAt,
                emailSent,
            },
        }, { status: 201 });
    } catch (error) {
        console.error("Invitation create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
