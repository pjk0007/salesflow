import type { NextApiRequest, NextApiResponse } from "next";
import { db, workspaces, folders } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
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

    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: "이름을 입력해주세요." });
    }

    try {
        // 워크스페이스 소유권 검증
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        const [created] = await db
            .insert(folders)
            .values({
                workspaceId,
                name: name.trim(),
            })
            .returning({
                id: folders.id,
                name: folders.name,
            });

        return res.status(201).json({ success: true, data: created });
    } catch (error) {
        console.error("Folder create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
