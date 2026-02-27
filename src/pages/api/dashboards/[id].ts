import type { NextApiRequest, NextApiResponse } from "next";
import { db, dashboards, dashboardWidgets } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "PUT") return handlePut(req, res);
    if (req.method === "DELETE") return handleDelete(req, res);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const dashboardId = Number(req.query.id);
    if (!dashboardId) {
        return res.status(400).json({ success: false, error: "대시보드 ID가 필요합니다." });
    }

    try {
        const [dashboard] = await db
            .select()
            .from(dashboards)
            .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, user.orgId)));

        if (!dashboard) {
            return res.status(404).json({ success: false, error: "대시보드를 찾을 수 없습니다." });
        }

        const widgets = await db
            .select()
            .from(dashboardWidgets)
            .where(eq(dashboardWidgets.dashboardId, dashboardId))
            .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));

        return res.status(200).json({
            success: true,
            data: { ...dashboard, widgets },
        });
    } catch (error) {
        console.error("Dashboard fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const dashboardId = Number(req.query.id);
    if (!dashboardId) {
        return res.status(400).json({ success: false, error: "대시보드 ID가 필요합니다." });
    }

    const { name, description, globalFilters, refreshInterval, isPublic, partitionIds } = req.body;

    try {
        const [existing] = await db
            .select({ id: dashboards.id })
            .from(dashboards)
            .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, user.orgId)));

        if (!existing) {
            return res.status(404).json({ success: false, error: "대시보드를 찾을 수 없습니다." });
        }

        const [updated] = await db
            .update(dashboards)
            .set({
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(globalFilters !== undefined && { globalFilters }),
                ...(refreshInterval !== undefined && {
                    refreshInterval: Math.min(300, Math.max(30, refreshInterval)),
                }),
                ...(isPublic !== undefined && { isPublic }),
                ...(partitionIds !== undefined && { partitionIds: Array.isArray(partitionIds) ? partitionIds : null }),
                updatedAt: new Date(),
            })
            .where(eq(dashboards.id, dashboardId))
            .returning();

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Dashboard update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const dashboardId = Number(req.query.id);
    if (!dashboardId) {
        return res.status(400).json({ success: false, error: "대시보드 ID가 필요합니다." });
    }

    try {
        const [existing] = await db
            .select({ id: dashboards.id })
            .from(dashboards)
            .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, user.orgId)));

        if (!existing) {
            return res.status(404).json({ success: false, error: "대시보드를 찾을 수 없습니다." });
        }

        await db.delete(dashboards).where(eq(dashboards.id, dashboardId));

        return res.status(200).json({ success: true, message: "대시보드가 삭제되었습니다." });
    } catch (error) {
        console.error("Dashboard delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
