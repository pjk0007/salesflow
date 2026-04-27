import { NextRequest, NextResponse } from "next/server";
import { db, records, partitions, workspaces } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

async function verifyPartitionAccess(partitionId: number, orgId: string) {
    const result = await db
        .select({ partition: partitions })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, orgId)));
    return result[0] ?? null;
}

const UNCATEGORIZED_KEY = "__uncategorized__";

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

    const access = await verifyPartitionAccess(partitionId, user.orgId);
    if (!access) {
        return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
    }

    const searchParams = req.nextUrl.searchParams;
    const groupBy = searchParams.get("groupBy");
    if (!groupBy) {
        return NextResponse.json({ success: false, error: "groupBy 파라미터가 필요합니다." }, { status: 400 });
    }

    const search = searchParams.get("search") || "";
    const distributionOrder = searchParams.get("distributionOrder")
        ? Number(searchParams.get("distributionOrder"))
        : undefined;

    let filters: Array<{ field: string; operator: string; value: unknown; valueTo?: unknown }> = [];
    const filtersParam = searchParams.get("filters");
    if (filtersParam) {
        try {
            filters = JSON.parse(filtersParam);
        } catch { /* 무시 */ }
    }

    try {
        const conditions = [eq(records.partitionId, partitionId)];

        if (search) {
            conditions.push(sql`${records.data}::text ILIKE ${"%" + search + "%"}`);
        }
        if (distributionOrder !== undefined) {
            conditions.push(eq(records.distributionOrder, distributionOrder));
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

        // SELECT의 표현식과 GROUP BY가 동일한 SQL 노드를 참조해야 PG가 동일 표현식으로 인식.
        // Drizzle은 sql`...`을 매번 새 노드로 재작성하므로, GROUP BY는 SELECT alias의 위치(1)로 지정.
        const rows = await db
            .select({
                groupValue: sql<string>`COALESCE(NULLIF(${records.data}->>${groupBy}, ''), ${UNCATEGORIZED_KEY})`.as("group_value"),
                cnt: sql<number>`COUNT(*)::int`.as("cnt"),
            })
            .from(records)
            .where(whereClause)
            .groupBy(sql`1`);

        const counts: Record<string, number> = {};
        let uncategorized = 0;
        let total = 0;

        for (const row of rows) {
            const cnt = Number(row.cnt) || 0;
            total += cnt;
            if (row.groupValue === UNCATEGORIZED_KEY) {
                uncategorized = cnt;
            } else {
                counts[row.groupValue] = cnt;
            }
        }

        return NextResponse.json({
            success: true,
            groupBy,
            counts,
            uncategorized,
            total,
        });
    } catch (error) {
        console.error("Group counts fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
