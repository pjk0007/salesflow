import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "PUT") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    try {
        const { name, industry, companySize } = req.body;

        const [org] = await db
            .select({ id: organizations.id, settings: organizations.settings })
            .from(organizations)
            .where(eq(organizations.id, user.orgId));

        if (!org) {
            return res.status(404).json({ success: false, error: "조직을 찾을 수 없습니다." });
        }

        const currentSettings = (org.settings as Record<string, unknown>) ?? {};
        const updatedSettings = {
            ...currentSettings,
            ...(industry !== undefined ? { industry } : {}),
            ...(companySize !== undefined ? { companySize } : {}),
        };

        const [updated] = await db
            .update(organizations)
            .set({
                ...(name?.trim() ? { name: name.trim() } : {}),
                settings: updatedSettings,
                updatedAt: new Date(),
            })
            .where(eq(organizations.id, user.orgId))
            .returning({
                id: organizations.id,
                name: organizations.name,
                settings: organizations.settings,
            });

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Org update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
