import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizations, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const orgs = await db
            .select({
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
                role: organizationMembers.role,
                joinedAt: organizationMembers.joinedAt,
            })
            .from(organizationMembers)
            .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
            .where(eq(organizationMembers.userId, user.userId));

        return res.status(200).json({
            success: true,
            data: orgs,
            currentOrgId: user.orgId,
        });
    } catch (error) {
        console.error("My orgs error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
