import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizationInvitations, users, organizationMembers } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";
import crypto from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    if (req.method === "GET") {
        return handleGet(res, user.orgId);
    }
    if (req.method === "POST") {
        return handlePost(req, res, user);
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(res: NextApiResponse, orgId: string) {
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
                    eq(organizationInvitations.orgId, orgId),
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

        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("Invitations fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(
    req: NextApiRequest,
    res: NextApiResponse,
    currentUser: { userId: string; orgId: string; role: string }
) {
    try {
        const { email, role } = req.body;

        if (!email || typeof email !== "string" || !email.includes("@")) {
            return res.status(400).json({ success: false, error: "유효한 이메일을 입력해주세요." });
        }

        if (!role || !["admin", "member"].includes(role)) {
            return res.status(400).json({ success: false, error: "유효하지 않은 역할입니다." });
        }

        // admin 역할 초대는 owner만
        if (role === "admin" && currentUser.role !== "owner") {
            return res.status(403).json({ success: false, error: "관리자 초대는 소유자만 가능합니다." });
        }

        // 플랜 제한 체크
        const currentCount = await getResourceCount(currentUser.orgId, "members");
        const limit = await checkPlanLimit(currentUser.orgId, "members", currentCount);
        if (!limit.allowed) {
            return res.status(403).json({
                success: false,
                error: `멤버 한도(${limit.limit}명)를 초과했습니다. 플랜 업그레이드가 필요합니다.`,
                upgradeRequired: true,
            });
        }

        // 이미 조직에 소속된 이메일 체크 (organizationMembers 기반)
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .innerJoin(organizationMembers, and(
                eq(organizationMembers.userId, users.id),
                eq(organizationMembers.organizationId, currentUser.orgId)
            ))
            .where(eq(users.email, email.toLowerCase()));

        if (existingUser) {
            return res.status(400).json({ success: false, error: "이미 조직에 소속된 이메일입니다." });
        }

        // 이미 대기 중인 초대 체크
        const [existingInvitation] = await db
            .select({ id: organizationInvitations.id })
            .from(organizationInvitations)
            .where(
                and(
                    eq(organizationInvitations.orgId, currentUser.orgId),
                    eq(organizationInvitations.email, email.toLowerCase()),
                    eq(organizationInvitations.status, "pending"),
                    gt(organizationInvitations.expiresAt, new Date())
                )
            );

        if (existingInvitation) {
            return res.status(400).json({ success: false, error: "이미 대기 중인 초대가 있습니다." });
        }

        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

        const [invitation] = await db
            .insert(organizationInvitations)
            .values({
                orgId: currentUser.orgId,
                email: email.toLowerCase(),
                role,
                token,
                invitedBy: currentUser.userId,
                expiresAt,
            })
            .returning();

        return res.status(201).json({
            success: true,
            data: {
                id: invitation.id,
                email: invitation.email,
                role: invitation.role,
                token: invitation.token,
                expiresAt: invitation.expiresAt,
            },
        });
    } catch (error) {
        console.error("Invitation create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
