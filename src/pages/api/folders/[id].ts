import type { NextApiRequest, NextApiResponse } from "next";
import { db, folders, partitions, workspaces } from "@/lib/db";
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

    const folderId = Number(req.query.id);
    if (!folderId || isNaN(folderId)) {
        return res.status(400).json({ success: false, error: "잘못된 폴더 ID입니다." });
    }

    if (req.method === "PATCH") return handlePatch(req, res, folderId, user.orgId);
    if (req.method === "DELETE") return handleDelete(res, folderId, user.orgId);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function verifyOwnership(folderId: number, orgId: string) {
    const result = await db
        .select({ folder: folders, wsOrgId: workspaces.orgId })
        .from(folders)
        .innerJoin(workspaces, eq(folders.workspaceId, workspaces.id))
        .where(and(eq(folders.id, folderId), eq(workspaces.orgId, orgId)));
    return result[0] ?? null;
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, folderId: number, orgId: string) {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: "이름을 입력해주세요." });
    }

    try {
        const access = await verifyOwnership(folderId, orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "폴더를 찾을 수 없습니다." });
        }

        const [updated] = await db
            .update(folders)
            .set({ name: name.trim(), updatedAt: new Date() })
            .where(eq(folders.id, folderId))
            .returning({ id: folders.id, name: folders.name });

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Folder update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(res: NextApiResponse, folderId: number, orgId: string) {
    try {
        const access = await verifyOwnership(folderId, orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "폴더를 찾을 수 없습니다." });
        }

        // 하위 파티션을 미분류로 이동
        await db
            .update(partitions)
            .set({ folderId: null })
            .where(eq(partitions.folderId, folderId));

        await db.delete(folders).where(eq(folders.id, folderId));

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Folder delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
