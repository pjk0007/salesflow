import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkTemplateLinks, partitions, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (req.method === "GET") {
        try {
            const partitionId = Number(req.query.partitionId);
            if (!partitionId) {
                return res.status(400).json({ success: false, error: "partitionId는 필수입니다." });
            }

            // 파티션 소유권 확인
            const [partition] = await db
                .select({ id: partitions.id })
                .from(partitions)
                .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
                .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
                .limit(1);

            if (!partition) {
                return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
            }

            const links = await db
                .select()
                .from(alimtalkTemplateLinks)
                .where(eq(alimtalkTemplateLinks.partitionId, partitionId))
                .orderBy(alimtalkTemplateLinks.createdAt);

            return res.status(200).json({ success: true, data: links });
        } catch (error) {
            console.error("Template links list error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    if (req.method === "POST") {
        try {
            const {
                partitionId,
                name,
                senderKey,
                templateCode,
                templateName,
                recipientField,
                variableMappings,
                triggerType = "manual",
                triggerCondition,
                repeatConfig,
            } = req.body;

            if (!partitionId || !name || !senderKey || !templateCode || !recipientField) {
                return res.status(400).json({
                    success: false,
                    error: "partitionId, name, senderKey, templateCode, recipientField는 필수입니다.",
                });
            }

            // 파티션 소유권 확인
            const [partition] = await db
                .select({ id: partitions.id })
                .from(partitions)
                .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
                .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
                .limit(1);

            if (!partition) {
                return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
            }

            const [created] = await db
                .insert(alimtalkTemplateLinks)
                .values({
                    partitionId,
                    name,
                    senderKey,
                    templateCode,
                    templateName: templateName || null,
                    recipientField,
                    variableMappings: variableMappings || null,
                    triggerType,
                    triggerCondition: triggerCondition || null,
                    repeatConfig: repeatConfig || null,
                    createdBy: user.userId,
                })
                .returning({ id: alimtalkTemplateLinks.id });

            return res.status(201).json({ success: true, data: { id: created.id } });
        } catch (error) {
            console.error("Template link create error:", error);
            return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}
