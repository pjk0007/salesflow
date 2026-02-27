import type { NextApiRequest, NextApiResponse } from "next";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, asc, desc } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

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

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(res: NextApiResponse, orgId: string) {
    try {
        const members = await db
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: organizationMembers.role,
                phone: users.phone,
                isActive: users.isActive,
                createdAt: users.createdAt,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(eq(organizationMembers.organizationId, orgId))
            .orderBy(desc(organizationMembers.role), asc(users.createdAt));

        return res.status(200).json({ success: true, data: members });
    } catch (error) {
        console.error("Members fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
