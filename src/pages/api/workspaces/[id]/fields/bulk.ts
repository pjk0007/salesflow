import type { NextApiRequest, NextApiResponse } from "next";
import { db, workspaces, fieldDefinitions, partitions } from "@/lib/db";
import { eq, and, max } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

const FIELD_TYPE_TO_CELL_TYPE: Record<string, string> = {
    text: "editable",
    number: "editable",
    currency: "currency",
    date: "date",
    datetime: "date",
    select: "select",
    phone: "phone",
    email: "email",
    textarea: "textarea",
    checkbox: "checkbox",
    file: "file",
    formula: "formula",
    user_select: "user_select",
};

const VALID_FIELD_TYPES = Object.keys(FIELD_TYPE_TO_CELL_TYPE);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }
    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const workspaceId = Number(req.query.id);
    if (!workspaceId) {
        return res.status(400).json({ success: false, error: "워크스페이스 ID가 필요합니다." });
    }

    const { fields } = req.body;
    if (!Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({ success: false, error: "fields 배열이 필요합니다." });
    }

    try {
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        // 기존 key 목록 조회
        const existingFieldList = await db
            .select({ key: fieldDefinitions.key })
            .from(fieldDefinitions)
            .where(eq(fieldDefinitions.workspaceId, workspaceId));

        const existingKeys = new Set(existingFieldList.map((f) => f.key));

        // max sortOrder 조회
        const [maxResult] = await db
            .select({ maxSort: max(fieldDefinitions.sortOrder) })
            .from(fieldDefinitions)
            .where(eq(fieldDefinitions.workspaceId, workspaceId));

        // 유효한 필드 필터링
        const fieldsToCreate: Array<{
            key: string;
            label: string;
            fieldType: string;
            category?: string;
            isRequired?: boolean;
            options?: string[];
        }> = [];
        let skippedCount = 0;

        for (const f of fields) {
            if (!f.key || !f.label) { skippedCount++; continue; }
            if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(f.key.trim())) { skippedCount++; continue; }
            if (!f.fieldType || !VALID_FIELD_TYPES.includes(f.fieldType)) { skippedCount++; continue; }
            if (existingKeys.has(f.key.trim())) { skippedCount++; continue; }
            fieldsToCreate.push(f);
        }

        if (fieldsToCreate.length === 0) {
            return res.status(200).json({
                success: true,
                data: { created: 0, skipped: skippedCount, total: fields.length },
            });
        }

        // 트랜잭션 내 순차 insert
        let currentSort = (maxResult?.maxSort ?? -1) + 1;
        const createdKeys: string[] = [];

        await db.transaction(async (tx) => {
            for (const f of fieldsToCreate) {
                await tx.insert(fieldDefinitions).values({
                    workspaceId,
                    key: f.key.trim(),
                    label: f.label.trim(),
                    fieldType: f.fieldType,
                    cellType: FIELD_TYPE_TO_CELL_TYPE[f.fieldType] || "editable",
                    category: f.category?.trim() || null,
                    isRequired: f.isRequired ? 1 : 0,
                    isSystem: 0,
                    sortOrder: currentSort,
                    defaultWidth: 120,
                    minWidth: 80,
                    options: f.fieldType === "select" && f.options?.length ? f.options : null,
                });
                createdKeys.push(f.key.trim());
                currentSort++;
            }
        });

        // 파티션 visibleFields 동기화
        const partitionList = await db
            .select({ id: partitions.id, visibleFields: partitions.visibleFields })
            .from(partitions)
            .where(eq(partitions.workspaceId, workspaceId));

        for (const p of partitionList) {
            const current = (p.visibleFields as string[]) || [];
            const newKeys = createdKeys.filter((k) => !current.includes(k));
            if (newKeys.length > 0) {
                await db
                    .update(partitions)
                    .set({
                        visibleFields: [...current, ...newKeys],
                        updatedAt: new Date(),
                    })
                    .where(eq(partitions.id, p.id));
            }
        }

        return res.status(201).json({
            success: true,
            data: { created: createdKeys.length, skipped: skippedCount, total: fields.length },
        });
    } catch (error) {
        console.error("Bulk fields create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
