import { buildRecordConditions, recordNumberSql, recordDateTimeSql } from "@/lib/record-filters";
import { buildRecordsCsv, recordExportFileName, RECORD_EXPORT_LIMIT } from "@/lib/record-export";
import { NextRequest, NextResponse } from "next/server";
import { db, records, fieldDefinitions } from "@/lib/db";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const access = await requirePartitionAccess(user, partitionId, "read");
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        const partition = access.partition;

        // 필드 목록 — 파티션의 fieldTypeId(또는 워크스페이스 defaultFieldTypeId) 우선,
        // 없으면 워크스페이스 기반으로 폴백
        const resolvedTypeId = partition.fieldTypeId ?? access.workspace.defaultFieldTypeId;
        const allFields = await db
            .select()
            .from(fieldDefinitions)
            .where(
                resolvedTypeId
                    ? eq(fieldDefinitions.fieldTypeId, resolvedTypeId)
                    : eq(fieldDefinitions.workspaceId, partition.workspaceId)
            )
            .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.id));

        // 쿼리 파라미터
        const searchParams = req.nextUrl.searchParams;
        const search = searchParams.get("search") || "";
        const sortField = searchParams.get("sortField") || "registeredAt";
        const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

        let filters: Array<{ field: string; operator: string; value: unknown; valueTo?: unknown }> = [];
        const filtersParam = searchParams.get("filters");
        if (filtersParam) {
            try { filters = JSON.parse(filtersParam); } catch { /* 무시 */ }
        }

        // WHERE 조건
        const distributionOrder = searchParams.has("distributionOrder") ? Number(searchParams.get("distributionOrder")) : undefined;
        const conditions = buildRecordConditions(partitionId, { orgId: user.orgId, search, distributionOrder, filters });

        const whereClause = and(...conditions);

        // 정렬
        let orderBy;
        if (sortField === "registeredAt") {
            orderBy = sortOrder === "asc" ? asc(records.registeredAt) : desc(records.registeredAt);
        } else if (sortField === "integratedCode") {
            orderBy = sortOrder === "asc" ? asc(records.integratedCode) : desc(records.integratedCode);
        } else if (sortField === "createdAt") {
            orderBy = sortOrder === "asc" ? asc(records.createdAt) : desc(records.createdAt);
        } else if (sortField === "updatedAt") {
            orderBy = sortOrder === "asc" ? asc(records.updatedAt) : desc(records.updatedAt);
        } else {
            const fieldDef = allFields.find(f => f.key === sortField);

            let jsonField;
            const ft = fieldDef?.fieldType;
            if (ft === "number" || ft === "currency") {
                jsonField = recordNumberSql(sortField);
            } else if (ft === "date" || ft === "datetime") {
                jsonField = recordDateTimeSql(sortField);
            } else {
                jsonField = sql`${records.data}->>${sortField}`;
            }
            orderBy = sortOrder === "asc" ? asc(jsonField) : desc(jsonField);
        }

        // 레코드 조회
        const data = await db
            .select()
            .from(records)
            .where(whereClause)
            .orderBy(orderBy, sortOrder === "asc" ? asc(records.id) : desc(records.id))
            .limit(RECORD_EXPORT_LIMIT);

        // CSV 생성 — 값 형식·시스템 항목·파일 이름 규칙은 lib/record-export.ts
        const csv = buildRecordsCsv(data, allFields);
        const filename = recordExportFileName(partition.name);

        return new NextResponse(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
            },
        });
    } catch (error) {
        console.error("CSV export error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
