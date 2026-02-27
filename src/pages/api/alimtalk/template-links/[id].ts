import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkTemplateLinks, partitions, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const linkId = Number(req.query.id);
    if (!linkId) {
        return res.status(400).json({ success: false, error: "유효하지 않은 ID입니다." });
    }

    // 소유권 확인
    const [link] = await db
        .select({
            id: alimtalkTemplateLinks.id,
            partitionId: alimtalkTemplateLinks.partitionId,
        })
        .from(alimtalkTemplateLinks)
        .innerJoin(partitions, eq(partitions.id, alimtalkTemplateLinks.partitionId))
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(and(eq(alimtalkTemplateLinks.id, linkId), eq(workspaces.orgId, user.orgId)))
        .limit(1);

    if (!link) {
        return res.status(404).json({ success: false, error: "템플릿 연결을 찾을 수 없습니다." });
    }

    if (req.method === "PUT") {
        try {
            const { name, recipientField, variableMappings, isActive,
                    triggerType, triggerCondition, repeatConfig } = req.body;

            const updateData: Record<string, unknown> = { updatedAt: new Date() };
            if (name !== undefined) updateData.name = name;
            if (recipientField !== undefined) updateData.recipientField = recipientField;
            if (variableMappings !== undefined) updateData.variableMappings = variableMappings;
            if (isActive !== undefined) updateData.isActive = isActive;
            if (triggerType !== undefined) updateData.triggerType = triggerType;
            if (triggerCondition !== undefined) updateData.triggerCondition = triggerCondition;
            if (repeatConfig !== undefined) updateData.repeatConfig = repeatConfig;

            await db
                .update(alimtalkTemplateLinks)
                .set(updateData)
                .where(eq(alimtalkTemplateLinks.id, linkId));

            return res.status(200).json({
                success: true,
                message: "템플릿 연결이 수정되었습니다.",
            });
        } catch (error) {
            console.error("Template link update error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "DELETE") {
        try {
            await db
                .delete(alimtalkTemplateLinks)
                .where(eq(alimtalkTemplateLinks.id, linkId));

            return res.status(200).json({
                success: true,
                message: "템플릿 연결이 삭제되었습니다.",
            });
        } catch (error) {
            console.error("Template link delete error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
