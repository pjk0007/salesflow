import { NextRequest, NextResponse } from "next/server";
import { db, organizationInvitations, organizationMembers } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { getActiveUserFromNextRequest, setSessionCookie } from "@/lib/auth";
import type { OrgRole } from "@/types";

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req, { scope: "account" });
    if (!user) return NextResponse.json({ success: false, error: "로그인이 필요합니다." }, { status: 401 });
    const fail = (error: string, status: number) => ({ response: NextResponse.json({ success: false, error }, { status }) });
    try {
        const { token } = await req.json();
        if (typeof token !== "string" || !token) return fail("초대 토큰이 필요합니다.", 400).response;
        const accepted = await db.transaction(async (tx) => {
            const [invitation] = await tx.select().from(organizationInvitations).where(and(
                eq(organizationInvitations.token, token), eq(organizationInvitations.status, "pending"),
                gt(organizationInvitations.expiresAt, new Date())
            )).for("update");
            if (!invitation || !["admin", "member"].includes(invitation.role)) return fail("유효하지 않거나 만료된 초대입니다.", 404);
            if (invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
                return fail("초대받은 이메일과 현재 계정 이메일이 일치하지 않습니다.", 403);
            }
            const [existing] = await tx.select().from(organizationMembers).where(and(
                eq(organizationMembers.userId, user.userId), eq(organizationMembers.organizationId, invitation.orgId)
            ));
            const member = existing ?? (await tx.insert(organizationMembers).values({
                organizationId: invitation.orgId, userId: user.userId, role: invitation.role,
            }).onConflictDoNothing().returning())[0];
            if (!member) return fail("이미 참여 중인 요청이 있습니다. 다시 확인해주세요.", 409);
            await tx.update(organizationInvitations).set({ status: "accepted" }).where(eq(organizationInvitations.id, invitation.id));
            return { member, orgId: invitation.orgId };
        });
        if ("response" in accepted) return accepted.response;
        const payload = {
            userId: user.userId, orgId: accepted.orgId, email: user.email, name: user.name,
            role: accepted.member.role as OrgRole, membershipId: accepted.member.id, tokenVersion: accepted.member.tokenVersion,
            ...(user.isSuperAdmin && { isSuperAdmin: true }),
        };
        const response = NextResponse.json({ success: true, user: payload, message: "초대를 수락하고 조직에 참여했습니다." });
        await setSessionCookie(response, payload);
        return response;
    } catch (error) {
        console.error("Invite accept error:", error);
        return fail("초대 수락을 처리하지 못했습니다. 다시 시도해주세요.", 500).response;
    }
}
