import type { NextApiRequest, NextApiResponse } from "next";
import { db, workspaces, fieldDefinitions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "PATCH") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }
    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const workspaceId = Number(req.query.id);
    if (!workspaceId) {
        return res.status(400).json({ success: false, error: "워크스페이스 ID가 필요합니다." });
    }

    const { fieldIds } = req.body;
    if (!Array.isArray(fieldIds) || fieldIds.length === 0) {
        return res.status(400).json({ success: false, error: "fieldIds 배열이 필요합니다." });
    }

    try {
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        // 각 fieldId에 대해 sortOrder 업데이트
        for (let i = 0; i < fieldIds.length; i++) {
            await db
                .update(fieldDefinitions)
                .set({ sortOrder: i, updatedAt: new Date() })
                .where(
                    and(
                        eq(fieldDefinitions.id, fieldIds[i]),
                        eq(fieldDefinitions.workspaceId, workspaceId)
                    )
                );
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Fields reorder error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
