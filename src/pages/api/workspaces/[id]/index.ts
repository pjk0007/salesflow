import type { NextApiRequest, NextApiResponse } from "next";
import { db, workspaces, partitions, records } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";
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
    if (req.method === "DELETE") {
        return handleDelete(res, workspaceId, user.orgId);
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(res: NextApiResponse, workspaceId: number, orgId: string) {
    try {
        const [ws] = await db
            .select()
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, orgId)));

        if (!ws) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        const [partitionResult] = await db
            .select({ count: count() })
            .from(partitions)
            .where(eq(partitions.workspaceId, workspaceId));

        const [recordResult] = await db
            .select({ count: count() })
            .from(records)
            .where(eq(records.workspaceId, workspaceId));

        return res.status(200).json({
            success: true,
            data: {
                partitionCount: partitionResult.count,
                recordCount: recordResult.count,
            },
        });
    } catch (error) {
        console.error("Workspace stats error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(res: NextApiResponse, workspaceId: number, orgId: string) {
    try {
        // 같은 조직의 워크스페이스인지 확인
        const [ws] = await db
            .select()
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, orgId)));

        if (!ws) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        // 최소 1개 워크스페이스 유지
        const [wsCount] = await db
            .select({ count: count() })
            .from(workspaces)
            .where(eq(workspaces.orgId, orgId));

        if (wsCount.count <= 1) {
            return res.status(400).json({ success: false, error: "마지막 워크스페이스는 삭제할 수 없습니다." });
        }

        await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Workspace delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
