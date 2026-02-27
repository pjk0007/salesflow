import type { NextApiRequest, NextApiResponse } from "next";
import { db, dashboards } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { nanoid } from "nanoid";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "POST") return handlePost(req, res);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const workspaceId = req.query.workspaceId ? Number(req.query.workspaceId) : undefined;

    try {
        const conditions = [eq(dashboards.orgId, user.orgId)];
        if (workspaceId) {
            conditions.push(eq(dashboards.workspaceId, workspaceId));
        }

        const data = await db
            .select()
            .from(dashboards)
            .where(and(...conditions))
            .orderBy(dashboards.createdAt);

        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("Dashboards fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const { name, workspaceId, description, partitionIds } = req.body;
    if (!name || !workspaceId) {
        return res.status(400).json({ success: false, error: "필수 항목이 누락되었습니다." });
    }

    try {
        const slug = nanoid(8);

        const [dashboard] = await db
            .insert(dashboards)
            .values({
                orgId: user.orgId,
                workspaceId,
                name,
                slug,
                description: description || null,
                partitionIds: Array.isArray(partitionIds) ? partitionIds : null,
                createdBy: user.userId,
            })
            .returning();

        return res.status(201).json({ success: true, data: dashboard });
    } catch (error) {
        console.error("Dashboard create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
