import type { NextApiRequest, NextApiResponse } from "next";
import { db, dashboards, dashboardWidgets } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const slug = req.query.slug as string;
    if (!slug) {
        return res.status(400).json({ success: false, error: "slug가 필요합니다." });
    }

    try {
        const [dashboard] = await db
            .select()
            .from(dashboards)
            .where(and(eq(dashboards.slug, slug), eq(dashboards.isPublic, 1)));

        if (!dashboard) {
            return res.status(404).json({ success: false, error: "대시보드를 찾을 수 없습니다." });
        }

        const widgets = await db
            .select()
            .from(dashboardWidgets)
            .where(eq(dashboardWidgets.dashboardId, dashboard.id))
            .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));

        return res.status(200).json({
            success: true,
            data: { ...dashboard, widgets },
        });
    } catch (error) {
        console.error("Public dashboard fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
