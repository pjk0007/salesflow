import type { NextApiRequest, NextApiResponse } from "next";
import { db, records, partitions, workspaces, organizations } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const partitionId = Number(req.query.id);
    if (!partitionId) {
        return res.status(400).json({ success: false, error: "파티션 ID가 필요합니다." });
    }

    const { records: importRecords, duplicateAction = "skip" } = req.body as {
        records: Array<Record<string, unknown>>;
        duplicateAction: "skip" | "error";
    };

    if (!Array.isArray(importRecords) || importRecords.length === 0) {
        return res.status(400).json({ success: false, error: "가져올 레코드가 없습니다." });
    }
    if (importRecords.length > 1000) {
        return res.status(400).json({ success: false, error: "최대 1,000건까지 가져올 수 있습니다." });
    }

    try {
        // 파티션 접근 검증
        const [access] = await db
            .select({ partition: partitions, workspaceOrgId: workspaces.orgId })
            .from(partitions)
            .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)));

        if (!access) {
            return res.status(404).json({ success: false, error: "파티션을 찾을 수 없습니다." });
        }

        const partition = access.partition;

        const result = await db.transaction(async (tx) => {
            // 조직 정보 (통합코드용)
            const [org] = await tx
                .select()
                .from(organizations)
                .where(eq(organizations.id, user.orgId));

            // 중복 체크 필드 확인
            const duplicateField = partition.duplicateCheckField;
            const existingValues = new Set<string>();
            if (duplicateField) {
                const existing = await tx
                    .select({ val: sql<string>`${records.data}->>${duplicateField}` })
                    .from(records)
                    .where(eq(records.partitionId, partitionId));
                for (const r of existing) {
                    if (r.val) existingValues.add(r.val);
                }
            }

            // 레코드 순회 삽입
            const errors: Array<{ row: number; message: string }> = [];
            let insertedCount = 0;
            let skippedCount = 0;
            let currentSeq = org.integratedCodeSeq;

            for (let i = 0; i < importRecords.length; i++) {
                const data = importRecords[i];

                // 중복 체크
                if (duplicateField && data[duplicateField]) {
                    const val = String(data[duplicateField]);
                    if (existingValues.has(val)) {
                        if (duplicateAction === "skip") {
                            skippedCount++;
                            continue;
                        } else {
                            errors.push({ row: i + 1, message: `중복: ${duplicateField}="${val}"` });
                            continue;
                        }
                    }
                    existingValues.add(val);
                }

                // 통합코드 생성
                currentSeq++;
                const integratedCode = `${org.integratedCodePrefix}-${String(currentSeq).padStart(4, "0")}`;

                await tx.insert(records).values({
                    orgId: user.orgId,
                    workspaceId: partition.workspaceId,
                    partitionId,
                    integratedCode,
                    data,
                });
                insertedCount++;
            }

            // 조직 시퀀스 업데이트
            await tx
                .update(organizations)
                .set({ integratedCodeSeq: currentSeq })
                .where(eq(organizations.id, org.id));

            return { totalCount: importRecords.length, insertedCount, skippedCount, errors };
        });

        return res.status(200).json({
            success: true,
            totalCount: result.totalCount,
            insertedCount: result.insertedCount,
            skippedCount: result.skippedCount,
            errors: result.errors,
        });
    } catch (error) {
        console.error("Bulk import error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
