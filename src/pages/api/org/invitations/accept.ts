import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizationInvitations, users, organizationMembers } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { hashPassword, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { OrgRole } from "@/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") {
        return handleValidate(req, res);
    }
    if (req.method === "POST") {
        return handleAccept(req, res);
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

// 토큰 유효성 확인 (초대 수락 페이지 로드 시)
async function handleValidate(req: NextApiRequest, res: NextApiResponse) {
    try {
        const token = req.query.token as string;
        if (!token) {
            return res.status(400).json({ success: false, error: "토큰이 필요합니다." });
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
            return res.status(400).json({ success: false, error: "만료되었거나 유효하지 않은 초대입니다." });
        }

        return res.status(200).json({
            success: true,
            data: {
                email: invitation.email,
                role: invitation.role,
            },
        });
    } catch (error) {
        console.error("Invitation validate error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

// 초대 수락
async function handleAccept(req: NextApiRequest, res: NextApiResponse) {
    try {
        const { token, name, password } = req.body;

        if (!token || !name || !password) {
            return res.status(400).json({ success: false, error: "모든 필드를 입력해주세요." });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, error: "비밀번호는 6자 이상이어야 합니다." });
        }

        const [invitation] = await db
            .select()
            .from(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.token, token),
                    eq(organizationInvitations.status, "pending"),
                    gt(organizationInvitations.expiresAt, new Date())
                )
            );

        if (!invitation) {
            return res.status(400).json({ success: false, error: "만료되었거나 유효하지 않은 초대입니다." });
        }

        // 이미 존재하는 사용자 체크 (organizationMembers 기반)
        const [existingMember] = await db
            .select({ id: users.id })
            .from(users)
            .innerJoin(organizationMembers, and(
                eq(organizationMembers.userId, users.id),
                eq(organizationMembers.organizationId, invitation.orgId)
            ))
            .where(eq(users.email, invitation.email));

        if (existingMember) {
            return res.status(400).json({ success: false, error: "이미 조직에 소속된 이메일입니다." });
        }

        const hashedPassword = await hashPassword(password);

        const [newUser] = await db
            .insert(users)
            .values({
                orgId: invitation.orgId,
                email: invitation.email,
                name: name.trim(),
                password: hashedPassword,
                role: invitation.role,
            })
            .returning({
                id: users.id,
                email: users.email,
                name: users.name,
                role: users.role,
            });

        // organizationMembers에 추가
        await db.insert(organizationMembers).values({
            organizationId: invitation.orgId,
            userId: newUser.id,
            role: invitation.role,
        });

        // 초대 상태 업데이트
        await db
            .update(organizationInvitations)
            .set({ status: "accepted" })
            .where(eq(organizationInvitations.id, invitation.id));

        // JWT 생성
        const jwtToken = generateToken({
            userId: newUser.id,
            orgId: invitation.orgId,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role as OrgRole,
        });

        const maxAge = Math.floor(getTokenExpiryMs() / 1000);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader(
            "Set-Cookie",
            `token=${jwtToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
        );

        return res.status(200).json({
            success: true,
            data: {
                userId: newUser.id,
                orgId: invitation.orgId,
            },
        });
    } catch (error) {
        console.error("Invitation accept error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
