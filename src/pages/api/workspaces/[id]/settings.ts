import type { NextApiRequest, NextApiResponse } from "next";
import { db, workspaces } from "@/lib/db";
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

    const workspaceId = Number(req.query.id);
    if (!workspaceId || isNaN(workspaceId)) {
        return res.status(400).json({ success: false, error: "잘못된 워크스페이스 ID입니다." });
    }

    if (req.method === "GET") {
        return handleGet(res, workspaceId, user.orgId);
    }
    if (req.method === "PATCH") {
        return handlePatch(req, res, workspaceId, user.orgId);
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(res: NextApiResponse, workspaceId: number, orgId: string) {
    try {
        const [ws] = await db
            .select({
                id: workspaces.id,
                name: workspaces.name,
                description: workspaces.description,
                icon: workspaces.icon,
                codePrefix: workspaces.codePrefix,
                settings: workspaces.settings,
            })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, orgId)));

        if (!ws) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        return res.status(200).json({ success: true, data: ws });
    } catch (error) {
        console.error("Workspace settings fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, workspaceId: number, orgId: string) {
    try {
        const { name, description, icon, codePrefix } = req.body;

        if (name !== undefined && !name.trim()) {
            return res.status(400).json({ success: false, error: "이름을 입력해주세요." });
        }

        // 같은 조직의 워크스페이스인지 확인
        const [existing] = await db
            .select()
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, orgId)));

        if (!existing) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            updateData.name = name.trim();
        }
        if (description !== undefined) {
            updateData.description = description;
        }
        if (icon !== undefined) {
            updateData.icon = icon;
        }
        if (codePrefix !== undefined) {
            updateData.codePrefix = codePrefix;
        }

        const [updated] = await db
            .update(workspaces)
            .set(updateData)
            .where(eq(workspaces.id, workspaceId))
            .returning({
                id: workspaces.id,
                name: workspaces.name,
                description: workspaces.description,
                icon: workspaces.icon,
                codePrefix: workspaces.codePrefix,
                settings: workspaces.settings,
            });

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Workspace settings update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
