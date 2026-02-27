import type { NextApiRequest, NextApiResponse } from "next";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const targetId = req.query.id as string;

    if (req.method === "PATCH") {
        return handlePatch(req, res, user, targetId);
    }
    if (req.method === "DELETE") {
        return handleDelete(res, user, targetId);
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handlePatch(
    req: NextApiRequest,
    res: NextApiResponse,
    currentUser: { userId: string; orgId: string; role: string },
    targetId: string
) {
    try {
        const { role } = req.body;
        if (!role || !["admin", "member"].includes(role)) {
            return res.status(400).json({ success: false, error: "유효하지 않은 역할입니다." });
        }

        if (currentUser.userId === targetId) {
            return res.status(403).json({ success: false, error: "자신의 역할은 변경할 수 없습니다." });
        }

        // organizationMembers에서 대상 조회
        const [target] = await db
            .select({
                id: users.id,
                role: organizationMembers.role,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, currentUser.orgId)
            ));

        if (!target) {
            return res.status(404).json({ success: false, error: "멤버를 찾을 수 없습니다." });
        }

        if (target.role === "owner") {
            return res.status(403).json({ success: false, error: "소유자의 역할은 변경할 수 없습니다." });
        }

        // admin은 admin 승격 불가
        if (currentUser.role === "admin" && role === "admin") {
            return res.status(403).json({ success: false, error: "관리자 승격 권한이 없습니다." });
        }

        // admin은 다른 admin 변경 불가
        if (currentUser.role === "admin" && target.role === "admin") {
            return res.status(403).json({ success: false, error: "관리자의 역할을 변경할 수 없습니다." });
        }

        // organizationMembers에서 role 업데이트
        await db
            .update(organizationMembers)
            .set({ role })
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, currentUser.orgId)
            ));

        return res.status(200).json({ success: true, data: { id: targetId, role } });
    } catch (error) {
        console.error("Member role update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(
    res: NextApiResponse,
    currentUser: { userId: string; orgId: string; role: string },
    targetId: string
) {
    try {
        if (currentUser.userId === targetId) {
            return res.status(403).json({ success: false, error: "자기 자신을 제거할 수 없습니다." });
        }

        // organizationMembers에서 대상 조회
        const [target] = await db
            .select({
                id: users.id,
                role: organizationMembers.role,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, currentUser.orgId)
            ));

        if (!target) {
            return res.status(404).json({ success: false, error: "멤버를 찾을 수 없습니다." });
        }

        if (target.role === "owner") {
            return res.status(403).json({ success: false, error: "소유자는 제거할 수 없습니다." });
        }

        // admin은 다른 admin 제거 불가
        if (currentUser.role === "admin" && target.role === "admin") {
            return res.status(403).json({ success: false, error: "관리자를 제거할 권한이 없습니다." });
        }

        // organizationMembers에서 제거
        await db
            .delete(organizationMembers)
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, currentUser.orgId)
            ));

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Member remove error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
