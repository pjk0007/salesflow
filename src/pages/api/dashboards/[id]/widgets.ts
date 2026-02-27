import type { NextApiRequest, NextApiResponse } from "next";
import { db, dashboards, dashboardWidgets } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "POST") return handlePost(req, res);
    if (req.method === "PUT") return handlePut(req, res);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function verifyDashboard(dashboardId: number, orgId: string) {
    const [dashboard] = await db
        .select()
        .from(dashboards)
        .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, orgId)));
    return dashboard ?? null;
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
        const dashboard = await verifyDashboard(dashboardId, user.orgId);
        if (!dashboard) {
            return res.status(404).json({ success: false, error: "대시보드를 찾을 수 없습니다." });
        }

        const widgets = await db
            .select()
            .from(dashboardWidgets)
            .where(eq(dashboardWidgets.dashboardId, dashboardId))
            .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));

        return res.status(200).json({ success: true, data: widgets });
    } catch (error) {
        console.error("Widgets fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const dashboardId = Number(req.query.id);
    if (!dashboardId) {
        return res.status(400).json({ success: false, error: "대시보드 ID가 필요합니다." });
    }

    const { title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn, widgetFilters } = req.body;
    if (!title || !widgetType || !dataColumn) {
        return res.status(400).json({ success: false, error: "필수 항목이 누락되었습니다." });
    }

    try {
        const dashboard = await verifyDashboard(dashboardId, user.orgId);
        if (!dashboard) {
            return res.status(404).json({ success: false, error: "대시보드를 찾을 수 없습니다." });
        }

        const [widget] = await db
            .insert(dashboardWidgets)
            .values({
                dashboardId,
                title,
                widgetType,
                dataColumn,
                aggregation: aggregation || "count",
                groupByColumn: groupByColumn || null,
                stackByColumn: stackByColumn || null,
                widgetFilters: widgetFilters || null,
            })
            .returning();

        return res.status(201).json({ success: true, data: widget });
    } catch (error) {
        console.error("Widget create error:", error);
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

    const { widgets } = req.body;
    if (!Array.isArray(widgets)) {
        return res.status(400).json({ success: false, error: "위젯 배열이 필요합니다." });
    }

    try {
        const dashboard = await verifyDashboard(dashboardId, user.orgId);
        if (!dashboard) {
            return res.status(404).json({ success: false, error: "대시보드를 찾을 수 없습니다." });
        }

        // 각 위젯 레이아웃 업데이트
        for (const w of widgets) {
            if (!w.id) continue;
            await db
                .update(dashboardWidgets)
                .set({
                    ...(w.title !== undefined && { title: w.title }),
                    ...(w.widgetType !== undefined && { widgetType: w.widgetType }),
                    ...(w.dataColumn !== undefined && { dataColumn: w.dataColumn }),
                    ...(w.aggregation !== undefined && { aggregation: w.aggregation }),
                    ...(w.groupByColumn !== undefined && { groupByColumn: w.groupByColumn }),
                    ...(w.stackByColumn !== undefined && { stackByColumn: w.stackByColumn }),
                    ...(w.widgetFilters !== undefined && { widgetFilters: w.widgetFilters }),
                    ...(w.layoutX !== undefined && { layoutX: w.layoutX }),
                    ...(w.layoutY !== undefined && { layoutY: w.layoutY }),
                    ...(w.layoutW !== undefined && { layoutW: w.layoutW }),
                    ...(w.layoutH !== undefined && { layoutH: w.layoutH }),
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(dashboardWidgets.id, w.id),
                        eq(dashboardWidgets.dashboardId, dashboardId)
                    )
                );
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Widgets update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
