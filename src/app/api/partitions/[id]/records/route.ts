import { NextRequest, NextResponse } from "next/server";
import { db, records, partitions, workspaces, organizations } from "@/lib/db";
import { eq, and, sql, desc, asc, count } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";
import { processAutoTrigger } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { assignDistributionOrder } from "@/lib/distribution";
import { broadcastToPartition } from "@/lib/sse";

async function verifyPartitionAccess(partitionId: number, orgId: string) {
    const result = await db
        .select({
            partition: partitions,
            workspaceOrgId: workspaces.orgId,
        })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, orgId)));

    return result[0] ?? null;
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
        const access = await verifyPartitionAccess(partitionId, user.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        const searchParams = req.nextUrl.searchParams;
        const page = Math.max(1, Number(searchParams.get("page")) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize")) || 50));
        const search = searchParams.get("search") || "";
        const distributionOrder = searchParams.get("distributionOrder")
            ? Number(searchParams.get("distributionOrder"))
            : undefined;
        const sortField = searchParams.get("sortField") || "registeredAt";
        const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

        // filters 파싱
        let filters: Array<{ field: string; operator: string; value: unknown; valueTo?: unknown }> = [];
        const filtersParam = searchParams.get("filters");
        if (filtersParam) {
            try {
                filters = JSON.parse(filtersParam);
            } catch { /* 무시 */ }
        }

        const offset = (page - 1) * pageSize;

        // WHERE 조건 구성
        const conditions = [eq(records.partitionId, partitionId)];

        if (search) {
            conditions.push(sql`${records.data}::text ILIKE ${"%" + search + "%"}`);
        }

        if (distributionOrder !== undefined) {
            conditions.push(eq(records.distributionOrder, distributionOrder));
        }

        // 필드별 필터 조건
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
                ? sortOrder === "asc"
                    ? asc(records.registeredAt)
                    : desc(records.registeredAt)
                : sortField === "integratedCode"
                    ? sortOrder === "asc"
                        ? asc(records.integratedCode)
                        : desc(records.integratedCode)
                    : sortOrder === "asc"
                        ? asc(records.createdAt)
                        : desc(records.createdAt);

        // 총 건수
        const [totalResult] = await db
            .select({ value: count() })
            .from(records)
            .where(whereClause);
        const total = totalResult?.value ?? 0;

        // 레코드 목록
        const data = await db
            .select()
            .from(records)
            .where(whereClause)
            .orderBy(orderBy)
            .limit(pageSize)
            .offset(offset);

        return NextResponse.json({
            success: true,
            data,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        console.error("Records fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

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

    const { data: recordData } = await req.json();
    if (!recordData || typeof recordData !== "object") {
        return NextResponse.json({ success: false, error: "레코드 데이터가 필요합니다." }, { status: 400 });
    }

    try {
        const access = await verifyPartitionAccess(partitionId, user.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        const partition = access.partition;

        // 플랜 제한 체크
        const currentCount = await getResourceCount(user.orgId, "records");
        const limit = await checkPlanLimit(user.orgId, "records", currentCount);
        if (!limit.allowed) {
            return NextResponse.json({
                success: false,
                error: `레코드 한도(${limit.limit}건)를 초과했습니다. 플랜 업그레이드가 필요합니다.`,
                upgradeRequired: true,
            }, { status: 403 });
        }

        // 중복 체크
        if (partition.duplicateCheckField) {
            const checkValue = recordData[partition.duplicateCheckField];
            if (checkValue) {
                const [duplicate] = await db
                    .select({ id: records.id })
                    .from(records)
                    .where(
                        and(
                            eq(records.partitionId, partitionId),
                            sql`${records.data}->>
                                ${partition.duplicateCheckField} = ${String(checkValue)}`
                        )
                    )
                    .limit(1);

                if (duplicate) {
                    return NextResponse.json({
                        success: false,
                        error: `중복된 데이터가 존재합니다. (${partition.duplicateCheckField}: ${checkValue})`,
                    }, { status: 409 });
                }
            }
        }

        // 트랜잭션으로 통합코드 발번 + 레코드 생성
        const result = await db.transaction(async (tx) => {
            // 통합코드 생성
            const [org] = await tx
                .select()
                .from(organizations)
                .where(eq(organizations.id, user.orgId));

            const newSeq = org.integratedCodeSeq + 1;
            const integratedCode = `${org.integratedCodePrefix}-${String(newSeq).padStart(4, "0")}`;

            await tx
                .update(organizations)
                .set({ integratedCodeSeq: newSeq })
                .where(eq(organizations.id, org.id));

            // 분배순서 자동 할당 (원자적)
            let distributionOrder: number | null = null;
            let finalData = recordData;
            const distribution = await assignDistributionOrder(tx, partition.id);
            if (distribution) {
                distributionOrder = distribution.distributionOrder;
                // defaults를 recordData에 병합 (빈 필드만)
                finalData = { ...distribution.defaults };
                for (const [k, v] of Object.entries(recordData)) {
                    if (v !== undefined && v !== null && v !== "") finalData[k] = v;
                }
            }

            // 레코드 생성
            const [newRecord] = await tx
                .insert(records)
                .values({
                    orgId: user.orgId,
                    workspaceId: partition.workspaceId,
                    partitionId,
                    integratedCode,
                    distributionOrder,
                    data: finalData,
                })
                .returning();

            return newRecord;
        });

        processAutoTrigger({
            record: result,
            partitionId,
            triggerType: "on_create",
            orgId: user.orgId,
        }).catch((err) => console.error("Auto trigger error:", err));

        processEmailAutoTrigger({
            record: result,
            partitionId,
            triggerType: "on_create",
            orgId: user.orgId,
        }).catch((err) => console.error("Email auto trigger error:", err));

        broadcastToPartition(partitionId, "record:created", {
            partitionId,
            recordId: result.id,
        }, req.headers.get("x-session-id") as string);

        return NextResponse.json({ success: true, data: result }, { status: 201 });
    } catch (error) {
        console.error("Record create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
