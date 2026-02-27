import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizationInvitations } from "@/lib/db";
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

    if (req.method === "DELETE") {
        const id = Number(req.query.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: "유효하지 않은 ID입니다." });
        }

        try {
            const [invitation] = await db
                .select({ id: organizationInvitations.id })
                .from(organizationInvitations)
                .where(
                    and(
                        eq(organizationInvitations.id, id),
                        eq(organizationInvitations.orgId, user.orgId)
                    )
                );

            if (!invitation) {
                return res.status(404).json({ success: false, error: "초대를 찾을 수 없습니다." });
            }

            await db
                .update(organizationInvitations)
                .set({ status: "cancelled" })
                .where(eq(organizationInvitations.id, id));

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error("Invitation cancel error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
