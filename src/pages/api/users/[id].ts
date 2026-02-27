import type { NextApiRequest, NextApiResponse } from "next";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "PATCH") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const currentUser = getUserFromRequest(req);
    if (!currentUser) {
        return res.status(401).json({ success: false, error: "인증되지 않았습니다." });
    }

    if (currentUser.role !== "owner" && currentUser.role !== "admin") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const targetId = String(req.query.id);
    if (!targetId) {
        return res.status(400).json({ success: false, error: "유효하지 않은 사용자 ID입니다." });
    }

    try {
        // 대상 사용자 조회 (organizationMembers 기반)
        const [targetUser] = await db
            .select({
                id: users.id,
                role: organizationMembers.role,
                isActive: users.isActive,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, currentUser.orgId)
            ));

        if (!targetUser) {
            return res.status(404).json({ success: false, error: "사용자를 찾을 수 없습니다." });
        }

        const { name, phone, role, isActive } = req.body;
        const isSelf = currentUser.userId === targetId;

        // 본인 역할 변경 불가
        if (isSelf && role !== undefined && role !== targetUser.role) {
            return res.status(403).json({
                success: false,
                error: "본인의 역할은 변경할 수 없습니다.",
            });
        }

        // 본인 비활성화 불가
        if (isSelf && isActive !== undefined && isActive === 0) {
            return res.status(403).json({
                success: false,
                error: "본인 계정은 비활성화할 수 없습니다.",
            });
        }

        // admin은 member만 수정 가능
        if (currentUser.role === "admin" && targetUser.role !== "member" && !isSelf) {
            return res.status(403).json({
                success: false,
                error: "해당 사용자를 수정할 권한이 없습니다.",
            });
        }

        // admin이 member가 아닌 역할로 변경 시도
        if (currentUser.role === "admin" && role && role !== "member") {
            return res.status(403).json({
                success: false,
                error: "admin은 member 역할만 부여할 수 있습니다.",
            });
        }

        // 역할 유효성 검증
        if (role && !["owner", "admin", "member"].includes(role)) {
            return res.status(400).json({
                success: false,
                error: "유효하지 않은 역할입니다.",
            });
        }

        // users 테이블 업데이트 (name, phone, isActive)
        const userUpdateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };
        if (name !== undefined) userUpdateData.name = name;
        if (phone !== undefined) userUpdateData.phone = phone || null;
        if (isActive !== undefined) userUpdateData.isActive = isActive;

        const [updated] = await db
            .update(users)
            .set(userUpdateData)
            .where(eq(users.id, targetId))
            .returning({
                id: users.id,
                name: users.name,
                email: users.email,
                phone: users.phone,
                isActive: users.isActive,
                updatedAt: users.updatedAt,
            });

        // role 변경은 organizationMembers에서
        let finalRole = targetUser.role;
        if (role !== undefined) {
            await db
                .update(organizationMembers)
                .set({ role })
                .where(and(
                    eq(organizationMembers.userId, targetId),
                    eq(organizationMembers.organizationId, currentUser.orgId)
                ));
            finalRole = role;
        }

        return res.status(200).json({
            success: true,
            data: { ...updated, role: finalRole },
        });
    } catch (error) {
        console.error("User update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
