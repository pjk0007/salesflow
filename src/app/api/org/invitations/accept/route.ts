import { NextRequest, NextResponse } from "next/server";
import { db, organizationInvitations, users, organizationMembers } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { hashPassword, verifyPassword, setSessionCookie } from "@/lib/auth";
import type { OrgRole } from "@/types";

export async function GET(req: NextRequest) {
    try {
        const token = req.nextUrl.searchParams.get("token");
        if (!token) {
            return NextResponse.json({ success: false, error: "토큰이 필요합니다." }, { status: 400 });
        }

        const [invitation] = await db
            .select({
                id: organizationInvitations.id,
                email: organizationInvitations.email,
                role: organizationInvitations.role,
                orgId: organizationInvitations.orgId,
                expiresAt: organizationInvitations.expiresAt,
            })
            .from(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.token, token),
                    eq(organizationInvitations.status, "pending"),
                    gt(organizationInvitations.expiresAt, new Date())
                )
            );

        if (!invitation) {
            return NextResponse.json({ success: false, error: "만료되었거나 유효하지 않은 초대입니다." }, { status: 400 });
        }

        // 이미 가입한 이메일이면 신규 가입 폼 대신 로그인 후 수락으로 유도
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, invitation.email));

        return NextResponse.json({
            success: true,
            data: {
                email: invitation.email,
                role: invitation.role,
                hasAccount: Boolean(existingUser),
            },
        });
    } catch (error) {
        console.error("Invitation validate error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const fail = (error: string, status: number) => ({ response: NextResponse.json({ success: false, error }, { status }) });
    try {
        const { token, email, name, password } = await req.json();
        if (typeof token !== "string" || !token || typeof password !== "string" || !password) {
            return fail("초대 링크와 비밀번호를 확인해주세요.", 400).response;
        }
        // 일반 세션을 허용하지 않고, 유효 초대와 수신 계정의 비밀번호를 함께 재인증한다.
        // 초대 행 잠금은 기존/신규 계정 모두 동시 수락을 한 번으로 제한한다.
        const accepted = await db.transaction(async (tx) => {
            const [invitation] = await tx.select().from(organizationInvitations).where(and(
                eq(organizationInvitations.token, token),
                eq(organizationInvitations.status, "pending"),
                gt(organizationInvitations.expiresAt, new Date())
            )).for("update");
            if (!invitation || !["admin", "member"].includes(invitation.role)) {
                return fail("만료되었거나 유효하지 않은 초대입니다.", 400);
            }
            const invitedEmail = invitation.email.trim().toLowerCase();
            const [existingUser] = await tx.select().from(users).where(eq(users.email, invitedEmail)).for("update");
            let account;
            if (existingUser) {
                if (typeof email !== "string" || email.trim().toLowerCase() !== invitedEmail) {
                    return fail("초대받은 이메일과 입력한 계정 이메일이 일치하지 않습니다.", 403);
                }
                if (existingUser.isActive !== 1) return fail("비활성 계정입니다. 관리자에게 문의해주세요.", 403);
                if (!await verifyPassword(password, existingUser.password)) {
                    return fail("이메일 또는 비밀번호가 올바르지 않습니다.", 401);
                }
                account = existingUser;
            } else {
                if (typeof name !== "string" || !name.trim() || password.length < 6) {
                    return fail("이름과 6자 이상의 비밀번호를 입력해주세요.", 400);
                }
                const [created] = await tx.insert(users).values({
                    orgId: invitation.orgId, email: invitedEmail, name: name.trim(),
                    password: await hashPassword(password), role: invitation.role,
                }).returning();
                account = created;
            }
            const [existingMember] = await tx.select().from(organizationMembers).where(and(
                eq(organizationMembers.userId, account.id), eq(organizationMembers.organizationId, invitation.orgId)
            ));
            const member = existingMember ?? (await tx.insert(organizationMembers).values({
                organizationId: invitation.orgId, userId: account.id, role: invitation.role,
            }).onConflictDoNothing().returning())[0];
            if (!member) return fail("이미 참여 중인 요청이 있습니다. 다시 확인해주세요.", 409);
            await tx.update(organizationInvitations).set({ status: "accepted" }).where(eq(organizationInvitations.id, invitation.id));
            return { account, member, orgId: invitation.orgId };
        });
        if ("response" in accepted) return accepted.response;
        const { account, member, orgId } = accepted;
        const response = NextResponse.json({ success: true, data: { userId: account.id, orgId } });
        await setSessionCookie(response, {
            userId: account.id, orgId, email: account.email, name: account.name,
            role: member.role as OrgRole, membershipId: member.id, tokenVersion: member.tokenVersion,
            ...(account.isSuperAdmin === 1 && { isSuperAdmin: true }),
        });
        return response;
    } catch (error) {
        console.error("Invitation accept error:", error);
        return fail("초대 수락을 처리하지 못했습니다. 다시 시도해주세요.", 500).response;
    }
}