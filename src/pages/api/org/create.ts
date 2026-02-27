import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizations, plans, subscriptions, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload } from "@/types";

function generateSlug(): string {
    return `org-${crypto.randomBytes(4).toString("hex")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const { name } = req.body;

        if (!name?.trim()) {
            return res.status(400).json({ success: false, error: "조직 이름을 입력해주세요." });
        }

        // 조직 생성
        const [newOrg] = await db
            .insert(organizations)
            .values({
                name: name.trim(),
                slug: generateSlug(),
            })
            .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug });

        // Free 구독 자동 생성
        const [freePlan] = await db
            .select({ id: plans.id })
            .from(plans)
            .where(eq(plans.slug, "free"));

        if (freePlan) {
            await db.insert(subscriptions).values({
                orgId: newOrg.id,
                planId: freePlan.id,
                status: "active",
            });
        }

        // owner 멤버십 생성
        await db.insert(organizationMembers).values({
            organizationId: newOrg.id,
            userId: user.userId,
            role: "owner",
        });

        // 새 조직으로 JWT 전환
        const payload: JWTPayload = {
            userId: user.userId,
            email: user.email,
            name: user.name,
            orgId: newOrg.id,
            role: "owner",
        };

        const token = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader(
            "Set-Cookie",
            `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
        );

        return res.status(200).json({
            success: true,
            data: { id: newOrg.id, name: newOrg.name, slug: newOrg.slug, role: "owner" },
        });
    } catch (error) {
        console.error("Create org error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
