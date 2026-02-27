import type { NextApiRequest, NextApiResponse } from "next";
import { db, emailTemplates } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const id = Number(req.query.id);
    if (!id) {
        return res.status(400).json({ success: false, error: "유효하지 않은 ID입니다." });
    }

    if (req.method === "GET") {
        try {
            const [template] = await db
                .select()
                .from(emailTemplates)
                .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId)))
                .limit(1);

            if (!template) {
                return res.status(404).json({ success: false, error: "템플릿을 찾을 수 없습니다." });
            }

            return res.status(200).json({ success: true, data: template });
        } catch (error) {
            console.error("Email template fetch error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "PUT") {
        try {
            const { name, subject, htmlBody, templateType, isActive, status, categoryId } = req.body;

            // 발행 시 필수 필드 검증
            if (status === "published") {
                const [current] = await db.select().from(emailTemplates)
                    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId))).limit(1);
                if (!current) return res.status(404).json({ success: false, error: "템플릿을 찾을 수 없습니다." });
                const finalName = name ?? current.name;
                const finalSubject = subject ?? current.subject;
                const finalHtmlBody = htmlBody ?? current.htmlBody;
                if (!finalName || !finalSubject || !finalHtmlBody) {
                    return res.status(400).json({ success: false, error: "발행하려면 이름, 제목, 본문이 모두 필요합니다." });
                }
            }

            const updateData: Record<string, unknown> = { updatedAt: new Date() };
            if (name !== undefined) updateData.name = name;
            if (subject !== undefined) updateData.subject = subject;
            if (htmlBody !== undefined) updateData.htmlBody = htmlBody;
            if (templateType !== undefined) updateData.templateType = templateType;
            if (isActive !== undefined) updateData.isActive = isActive;
            if (status !== undefined) updateData.status = status;
            if (categoryId !== undefined) updateData.categoryId = categoryId;

            const [updated] = await db
                .update(emailTemplates)
                .set(updateData)
                .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId)))
                .returning();

            if (!updated) {
                return res.status(404).json({ success: false, error: "템플릿을 찾을 수 없습니다." });
            }

            return res.status(200).json({ success: true, data: updated });
        } catch (error) {
            console.error("Email template update error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "DELETE") {
        try {
            const [deleted] = await db
                .delete(emailTemplates)
                .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId)))
                .returning({ id: emailTemplates.id });

            if (!deleted) {
                return res.status(404).json({ success: false, error: "템플릿을 찾을 수 없습니다." });
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error("Email template delete error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
