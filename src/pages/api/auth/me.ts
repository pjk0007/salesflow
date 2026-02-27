import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { db, organizations, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증되지 않았습니다." });
    }

    const [org] = await db
        .select({ onboardingCompleted: organizations.onboardingCompleted })
        .from(organizations)
        .where(eq(organizations.id, user.orgId));

    // 소속 조직 목록
    const myOrgs = await db
        .select({
            organizationId: organizationMembers.organizationId,
            role: organizationMembers.role,
            orgName: organizations.name,
            orgSlug: organizations.slug,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, user.userId));

    return res.status(200).json({
        success: true,
        user: {
            ...user,
            onboardingCompleted: org?.onboardingCompleted ?? false,
            organizations: myOrgs,
        },
    });
}
