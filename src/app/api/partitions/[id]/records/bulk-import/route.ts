import { NextRequest, NextResponse } from "next/server";
import { db, records, partitions, workspaces, organizations } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    const body = await req.json();
    const { records: importRecords, duplicateAction = "skip" } = body as {
        records: Array<Record<string, unknown>>;
        duplicateAction: "skip" | "error";
    };

    if (!Array.isArray(importRecords) || importRecords.length === 0) {
        return NextResponse.json({ success: false, error: "가져올 레코드가 없습니다." }, { status: 400 });
    }
    if (importRecords.length > 1000) {
        return NextResponse.json({ success: false, error: "최대 1,000건까지 가져올 수 있습니다." }, { status: 400 });
    }

    try {
        // 파티션 접근 검증
        const [access] = await db
            .select({ partition: partitions, workspaceOrgId: workspaces.orgId })
            .from(partitions)
            .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)));

        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
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

        return NextResponse.json({
            success: true,
            totalCount: result.totalCount,
            insertedCount: result.insertedCount,
            skippedCount: result.skippedCount,
            errors: result.errors,
        });
    } catch (error) {
        console.error("Bulk import error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
