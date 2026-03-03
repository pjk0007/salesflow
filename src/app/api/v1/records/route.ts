import { NextRequest, NextResponse } from "next/server";
import { db, records, partitions, workspaces, organizations } from "@/lib/db";
import { eq, and, sql, desc, asc, count } from "drizzle-orm";
import { getApiTokenFromNextRequest, resolveApiToken, checkTokenAccess } from "@/lib/auth";
import type { ApiTokenInfo } from "@/lib/auth";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";
import { processAutoTrigger } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { assignDistributionOrder } from "@/lib/distribution";
import { broadcastToPartition } from "@/lib/sse";

async function authenticateExternalRequest(req: NextRequest): Promise<ApiTokenInfo | null> {
    const tokenStr = getApiTokenFromNextRequest(req);
    if (!tokenStr) return null;
    return resolveApiToken(tokenStr);
}

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

// GET /api/v1/records?partitionId=N&page=1&pageSize=50&search=...&filters=[...]
export async function GET(req: NextRequest) {
    const tokenInfo = await authenticateExternalRequest(req);
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const partitionId = Number(searchParams.get("partitionId"));
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "partitionId is required." }, { status: 400 });
    }

    const hasAccess = await checkTokenAccess(tokenInfo, partitionId, "read");
    if (!hasAccess) {
        return NextResponse.json({ success: false, error: "Access denied for this partition." }, { status: 403 });
    }

    try {
        const access = await verifyPartitionAccess(partitionId, tokenInfo.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "Partition not found." }, { status: 404 });
        }

        const page = Math.max(1, Number(searchParams.get("page")) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize")) || 50));
        const search = searchParams.get("search") || "";
        const sortField = searchParams.get("sortField") || "registeredAt";
        const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

        let filters: Array<{ field: string; operator: string; value: unknown; valueTo?: unknown }> = [];
        const filtersParam = searchParams.get("filters");
        if (filtersParam) {
            try { filters = JSON.parse(filtersParam); } catch { /* ignore */ }
        }

        const offset = (page - 1) * pageSize;
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
            }
        }

        const whereClause = and(...conditions);

        const orderBy =
            sortField === "registeredAt"
                ? sortOrder === "asc" ? asc(records.registeredAt) : desc(records.registeredAt)
                : sortField === "integratedCode"
                    ? sortOrder === "asc" ? asc(records.integratedCode) : desc(records.integratedCode)
                    : sortOrder === "asc" ? asc(records.createdAt) : desc(records.createdAt);

        const [totalResult] = await db
            .select({ value: count() })
            .from(records)
            .where(whereClause);
        const total = totalResult?.value ?? 0;

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
        console.error("External records fetch error:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
}

// POST /api/v1/records
export async function POST(req: NextRequest) {
    const tokenInfo = await authenticateExternalRequest(req);
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }

    try {
        const { partitionId, data: recordData } = await req.json();

        if (!partitionId || typeof partitionId !== "number") {
            return NextResponse.json({ success: false, error: "partitionId is required." }, { status: 400 });
        }
        if (!recordData || typeof recordData !== "object") {
            return NextResponse.json({ success: false, error: "data is required." }, { status: 400 });
        }

        const hasAccess = await checkTokenAccess(tokenInfo, partitionId, "create");
        if (!hasAccess) {
            return NextResponse.json({ success: false, error: "Access denied for this partition." }, { status: 403 });
        }

        const access = await verifyPartitionAccess(partitionId, tokenInfo.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "Partition not found." }, { status: 404 });
        }

        const partition = access.partition;

        // 플랜 제한 체크
        const currentCount = await getResourceCount(tokenInfo.orgId, "records");
        const limit = await checkPlanLimit(tokenInfo.orgId, "records", currentCount);
        if (!limit.allowed) {
            return NextResponse.json({
                success: false,
                error: `Record limit (${limit.limit}) exceeded. Plan upgrade required.`,
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
                            sql`${records.data}->>${partition.duplicateCheckField} = ${String(checkValue)}`
                        )
                    )
                    .limit(1);

                if (duplicate) {
                    return NextResponse.json({
                        success: false,
                        error: `Duplicate data exists. (${partition.duplicateCheckField}: ${checkValue})`,
                    }, { status: 409 });
                }
            }
        }

        const result = await db.transaction(async (tx) => {
            const [org] = await tx
                .select()
                .from(organizations)
                .where(eq(organizations.id, tokenInfo.orgId));

            const newSeq = org.integratedCodeSeq + 1;
            const integratedCode = `${org.integratedCodePrefix}-${String(newSeq).padStart(4, "0")}`;

            await tx
                .update(organizations)
                .set({ integratedCodeSeq: newSeq })
                .where(eq(organizations.id, org.id));

            let distributionOrder: number | null = null;
            let finalData = recordData;
            const distribution = await assignDistributionOrder(tx, partition.id);
            if (distribution) {
                distributionOrder = distribution.distributionOrder;
                finalData = { ...distribution.defaults };
                for (const [k, v] of Object.entries(recordData)) {
                    if (v !== undefined && v !== null && v !== "") finalData[k] = v;
                }
            }

            const [newRecord] = await tx
                .insert(records)
                .values({
                    orgId: tokenInfo.orgId,
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
            orgId: tokenInfo.orgId,
        }).catch((err) => console.error("Auto trigger error:", err));

        processEmailAutoTrigger({
            record: result,
            partitionId,
            triggerType: "on_create",
            orgId: tokenInfo.orgId,
        }).catch((err) => console.error("Email auto trigger error:", err));

        broadcastToPartition(partitionId, "record:created", {
            partitionId,
            recordId: result.id,
        }, "");

        return NextResponse.json({ success: true, data: result }, { status: 201 });
    } catch (error) {
        console.error("External record create error:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
}
