import type { NextApiRequest, NextApiResponse } from "next";
import { db, fieldDefinitions, workspaces, partitions } from "@/lib/db";
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

    const fieldId = Number(req.query.id);
    if (!fieldId || isNaN(fieldId)) {
        return res.status(400).json({ success: false, error: "잘못된 필드 ID입니다." });
    }

    if (req.method === "PATCH") return handlePatch(req, res, fieldId, user.orgId);
    if (req.method === "DELETE") return handleDelete(res, fieldId, user.orgId);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function verifyOwnership(fieldId: number, orgId: string) {
    const result = await db
        .select({ field: fieldDefinitions, wsOrgId: workspaces.orgId })
        .from(fieldDefinitions)
        .innerJoin(workspaces, eq(fieldDefinitions.workspaceId, workspaces.id))
        .where(and(eq(fieldDefinitions.id, fieldId), eq(workspaces.orgId, orgId)));
    return result[0] ?? null;
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, fieldId: number, orgId: string) {
    const { label, category, isRequired, options, defaultWidth } = req.body;

    try {
        const access = await verifyOwnership(fieldId, orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "필드를 찾을 수 없습니다." });
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (label !== undefined) {
            if (!label.trim()) {
                return res.status(400).json({ success: false, error: "라벨을 입력해주세요." });
            }
            updates.label = label.trim();
        }
        if (category !== undefined) {
            updates.category = category?.trim() || null;
        }
        if (isRequired !== undefined) {
            updates.isRequired = isRequired ? 1 : 0;
        }
        if (options !== undefined) {
            updates.options = Array.isArray(options) && options.length > 0 ? options : null;
        }
        if (defaultWidth !== undefined) {
            updates.defaultWidth = Math.max(40, Number(defaultWidth) || 120);
        }

        const [updated] = await db
            .update(fieldDefinitions)
            .set(updates)
            .where(eq(fieldDefinitions.id, fieldId))
            .returning({ id: fieldDefinitions.id, label: fieldDefinitions.label });

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Field update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(res: NextApiResponse, fieldId: number, orgId: string) {
    try {
        const access = await verifyOwnership(fieldId, orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "필드를 찾을 수 없습니다." });
        }

        if (access.field.isSystem) {
            return res.status(400).json({ success: false, error: "시스템 필드는 삭제할 수 없습니다." });
        }

        const fieldKey = access.field.key;
        const workspaceId = access.field.workspaceId;

        await db.delete(fieldDefinitions).where(eq(fieldDefinitions.id, fieldId));

        // 파티션 visibleFields에서 삭제된 key 제거
        const partitionList = await db
            .select({ id: partitions.id, visibleFields: partitions.visibleFields })
            .from(partitions)
            .where(eq(partitions.workspaceId, workspaceId));

        for (const p of partitionList) {
            const currentFields = (p.visibleFields as string[]) || [];
            if (currentFields.includes(fieldKey)) {
                await db
                    .update(partitions)
                    .set({
                        visibleFields: currentFields.filter((k) => k !== fieldKey),
                        updatedAt: new Date(),
                    })
                    .where(eq(partitions.id, p.id));
            }
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Field delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
