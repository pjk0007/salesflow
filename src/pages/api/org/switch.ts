import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizationMembers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload, OrgRole } from "@/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const { orgId } = req.body;
    if (!orgId || typeof orgId !== "string") {
        return res.status(400).json({ success: false, error: "조직 ID가 필요합니다." });
    }

    try {
        // 소속 확인
        const [membership] = await db
            .select({
                organizationId: organizationMembers.organizationId,
                role: organizationMembers.role,
            })
            .from(organizationMembers)
            .where(and(
                eq(organizationMembers.userId, user.userId),
                eq(organizationMembers.organizationId, orgId)
            ));

        if (!membership) {
            return res.status(403).json({
                success: false,
                error: "해당 조직에 소속되어 있지 않습니다.",
            });
        }

        // JWT 재발급
        const payload: JWTPayload = {
            userId: user.userId,
            orgId: membership.organizationId,
            email: user.email,
            name: user.name,
            role: membership.role as OrgRole,
        };

        const token = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader(
            "Set-Cookie",
            `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
        );

        return res.status(200).json({ success: true, user: payload });
    } catch (error) {
        console.error("Org switch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
