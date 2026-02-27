import type { NextApiRequest, NextApiResponse } from "next";
import { db, emailTemplates } from "@/lib/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (req.method === "GET") {
        try {
            const page = Number(req.query.page) || 1;
            const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);
            const offset = (page - 1) * pageSize;
            const statusFilter = req.query.status as string | undefined;

            const whereClause = statusFilter
                ? and(eq(emailTemplates.orgId, user.orgId), eq(emailTemplates.status, statusFilter))
                : eq(emailTemplates.orgId, user.orgId);

            const [countResult] = await db
                .select({ count: sql<number>`count(*)` })
                .from(emailTemplates)
                .where(whereClause);

            const templates = await db
                .select()
                .from(emailTemplates)
                .where(whereClause)
                .orderBy(desc(emailTemplates.createdAt))
                .limit(pageSize)
                .offset(offset);

            return res.status(200).json({
                success: true,
                data: templates,
                totalCount: Number(countResult.count),
            });
        } catch (error) {
            console.error("Email templates fetch error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "POST") {
        try {
            const { name, subject, htmlBody, templateType, status, categoryId } = req.body;
            if (status !== "draft" && (!name || !subject || !htmlBody)) {
                return res.status(400).json({ success: false, error: "name, subject, htmlBody는 필수입니다." });
            }

            const [created] = await db
                .insert(emailTemplates)
                .values({
                    orgId: user.orgId,
                    name: name || "",
                    subject: subject || "",
                    htmlBody: htmlBody || "",
                    templateType: templateType || null,
                    categoryId: categoryId ?? null,
                    status: status || "published",
                })
                .returning();

            return res.status(201).json({ success: true, data: created });
        } catch (error) {
            console.error("Email template create error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
