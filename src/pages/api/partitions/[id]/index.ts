import type { NextApiRequest, NextApiResponse } from "next";
import { db, partitions, workspaces, records } from "@/lib/db";
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

    const partitionId = Number(req.query.id);
    if (!partitionId || isNaN(partitionId)) {
        return res.status(400).json({ success: false, error: "잘못된 파티션 ID입니다." });
    }

    if (req.method === "GET") return handleGet(res, partitionId, user.orgId);
    if (req.method === "PATCH") return handlePatch(req, res, partitionId, user.orgId);
    if (req.method === "DELETE") return handleDelete(res, partitionId, user.orgId);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function verifyOwnership(partitionId: number, orgId: string) {
    const result = await db
        .select({ partition: partitions, wsOrgId: workspaces.orgId })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, orgId)));
    return result[0] ?? null;
}

async function handleGet(res: NextApiResponse, partitionId: number, orgId: string) {
    try {
        const access = await verifyOwnership(partitionId, orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "파티션을 찾을 수 없습니다." });
        }

        const [result] = await db
            .select({ count: count() })
            .from(records)
            .where(eq(records.partitionId, partitionId));

        return res.status(200).json({
            success: true,
            data: {
                ...access.partition,
                recordCount: result.count,
            },
        });
    } catch (error) {
        console.error("Partition stats error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, partitionId: number, orgId: string) {
    const { name, useDistributionOrder, maxDistributionOrder, distributionDefaults } = req.body;

    // name-only 업데이트가 아닌 경우에도 지원
    if (name !== undefined && (!name || !String(name).trim())) {
        return res.status(400).json({ success: false, error: "이름을 입력해주세요." });
    }

    try {
        const access = await verifyOwnership(partitionId, orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "파티션을 찾을 수 없습니다." });
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (name !== undefined) {
            updateData.name = String(name).trim();
        }

        if (useDistributionOrder !== undefined) {
            updateData.useDistributionOrder = useDistributionOrder ? 1 : 0;
        }

        if (maxDistributionOrder !== undefined) {
            const max = Number(maxDistributionOrder);
            if (max < 1 || max > 99) {
                return res.status(400).json({ success: false, error: "분배 순번은 1~99 범위여야 합니다." });
            }
            updateData.maxDistributionOrder = max;
            // lastAssignedOrder가 새 max를 초과하면 리셋
            if (access.partition.lastAssignedOrder > max) {
                updateData.lastAssignedOrder = 0;
            }
        }

        if (distributionDefaults !== undefined) {
            updateData.distributionDefaults = distributionDefaults;
        }

        const [updated] = await db
            .update(partitions)
            .set(updateData)
            .where(eq(partitions.id, partitionId))
            .returning();

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Partition update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(res: NextApiResponse, partitionId: number, orgId: string) {
    try {
        const access = await verifyOwnership(partitionId, orgId);
        if (!access) {
            return res.status(404).json({ success: false, error: "파티션을 찾을 수 없습니다." });
        }

        await db.delete(partitions).where(eq(partitions.id, partitionId));

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Partition delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
