import { NextRequest, NextResponse } from "next/server";
import { db, records, partitions, workspaces, fieldDefinitions } from "@/lib/db";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

const EXCLUDED_TYPES = ["file", "formula", "user_select"];
const MAX_EXPORT = 10000;

function formatValue(value: unknown, fieldType: string): string {
    if (value === null || value === undefined) return "";
    switch (fieldType) {
        case "date":
            try {
                return new Date(String(value)).toISOString().split("T")[0];
            } catch {
                return String(value);
            }
        case "datetime":
            try {
                const d = new Date(String(value));
                return `${d.toISOString().split("T")[0]} ${d.toTimeString().slice(0, 5)}`;
            } catch {
                return String(value);
            }
        case "checkbox":
            return Boolean(value) ? "TRUE" : "FALSE";
        default:
            return String(value);
    }
}

function escapeCsv(val: string): string {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
}

export async function GET(
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

        // 필드 목록
        const allFields = await db
            .select()
            .from(fieldDefinitions)
            .where(eq(fieldDefinitions.workspaceId, partition.workspaceId))
            .orderBy(asc(fieldDefinitions.sortOrder));

        const exportFields = allFields.filter(f => !EXCLUDED_TYPES.includes(f.fieldType));

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
        const conditions = [eq(records.partitionId, partitionId)];

        if (search) {
            conditions.push(sql`${records.data}::text ILIKE ${"%" + search + "%"}`);
        }

        for (const f of filters) {
            const key = f.field;
            const val = f.value;
            switch (f.operator) {
                case "contains":
                    conditions.push(sql`${records.data}->>${key} ILIKE ${"%" + val + "%"}`);
                    break;
                case "equals":
                    conditions.push(sql`${records.data}->>${key} = ${String(val)}`);
                    break;
                case "not_equals":
                    conditions.push(sql`${records.data}->>${key} != ${String(val)}`);
                    break;
                case "gt":
                    conditions.push(sql`(${records.data}->>${key})::numeric > ${Number(val)}`);
                    break;
                case "gte":
                    conditions.push(sql`(${records.data}->>${key})::numeric >= ${Number(val)}`);
                    break;
                case "lt":
                    conditions.push(sql`(${records.data}->>${key})::numeric < ${Number(val)}`);
                    break;
                case "lte":
                    conditions.push(sql`(${records.data}->>${key})::numeric <= ${Number(val)}`);
                    break;
                case "before":
                    conditions.push(sql`(${records.data}->>${key})::date < ${String(val)}::date`);
                    break;
                case "after":
                    conditions.push(sql`(${records.data}->>${key})::date > ${String(val)}::date`);
                    break;
                case "between":
                    conditions.push(sql`(${records.data}->>${key})::date >= ${String(val)}::date`);
                    conditions.push(sql`(${records.data}->>${key})::date <= ${String(f.valueTo)}::date`);
                    break;
                case "is_empty":
                    conditions.push(sql`(${records.data}->>${key} IS NULL OR ${records.data}->>${key} = '')`);
                    break;
                case "is_not_empty":
                    conditions.push(sql`(${records.data}->>${key} IS NOT NULL AND ${records.data}->>${key} != '')`);
                    break;
                case "is_true":
                    conditions.push(sql`(${records.data}->>${key})::boolean = true`);
                    break;
                case "is_false":
                    conditions.push(sql`(${records.data}->>${key} IS NULL OR (${records.data}->>${key})::boolean = false)`);
                    break;
            }
        }

        const whereClause = and(...conditions);

        // 정렬
        const orderBy =
            sortField === "registeredAt"
                ? sortOrder === "asc" ? asc(records.registeredAt) : desc(records.registeredAt)
                : sortField === "integratedCode"
                    ? sortOrder === "asc" ? asc(records.integratedCode) : desc(records.integratedCode)
                    : sortOrder === "asc" ? asc(records.createdAt) : desc(records.createdAt);

        // 레코드 조회
        const data = await db
            .select()
            .from(records)
            .where(whereClause)
            .orderBy(orderBy)
            .limit(MAX_EXPORT);

        // CSV 생성
        const BOM = "\uFEFF";
        const headers = ["통합코드", ...exportFields.map(f => f.label)];

        const rows = data.map(record => {
            const d = record.data as Record<string, unknown>;
            return [
                record.integratedCode || "",
                ...exportFields.map(f => formatValue(d[f.key], f.fieldType)),
            ].map(escapeCsv).join(",");
        });

        const csv = BOM + [headers.map(escapeCsv).join(","), ...rows].join("\n");

        // 응답
        const partitionName = partition.name || "records";
        const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
        const filename = `${partitionName}_${dateStr}.csv`;

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
