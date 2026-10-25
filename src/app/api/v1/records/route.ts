import { NextRequest, NextResponse } from "next/server";
import { db, records, partitions, workspaces, fieldDefinitions } from "@/lib/db";
import { eq, and, sql, desc, asc, count } from "drizzle-orm";
import { getApiTokenFromNextRequest, resolveApiToken, checkTokenAccess } from "@/lib/auth";
import type { ApiTokenInfo } from "@/lib/auth";
import { createRecord, toRecordCreatePartition } from "@/lib/record-create";
import { parseEventInput, insertRecordEvent } from "@/lib/record-events";
import { rematchVisitorsByRecord } from "@/lib/tracker/match-record";

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

        let orderBy;
        if (sortField === "registeredAt") {
            orderBy = sortOrder === "asc" ? asc(records.registeredAt) : desc(records.registeredAt);
        } else if (sortField === "integratedCode") {
            orderBy = sortOrder === "asc" ? asc(records.integratedCode) : desc(records.integratedCode);
        } else if (sortField === "createdAt") {
            orderBy = sortOrder === "asc" ? asc(records.createdAt) : desc(records.createdAt);
        } else {
            const [fieldDef] = await db
                .select({ fieldType: fieldDefinitions.fieldType })
                .from(fieldDefinitions)
                .where(and(eq(fieldDefinitions.workspaceId, access.partition.workspaceId), eq(fieldDefinitions.key, sortField)));

            let jsonField;
            const ft = fieldDef?.fieldType;
            if (ft === "number" || ft === "currency") {
                jsonField = sql`(${records.data}->>${sortField})::numeric`;
            } else if (ft === "date" || ft === "datetime") {
                jsonField = sql`(${records.data}->>${sortField})::timestamptz`;
            } else {
                jsonField = sql`${records.data}->>${sortField}`;
            }
            orderBy = sortOrder === "asc" ? asc(jsonField) : desc(jsonField);
        }

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
async function handlePost(req: NextRequest) {
    const tokenInfo = await authenticateExternalRequest(req);
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }

    try {
        const { partitionId, data: recordData, event } = await req.json();

        if (!partitionId || typeof partitionId !== "number") {
            return NextResponse.json({ success: false, error: "partitionId is required." }, { status: 400 });
        }
        if (!recordData || typeof recordData !== "object") {
            return NextResponse.json({ success: false, error: "data is required." }, { status: 400 });
        }

        // event 사전 검증 — record 만들기 전에. 실패 시 record 생성 안 함.
        const eventParsed = event != null ? parseEventInput(event) : null;
        if (eventParsed && !eventParsed.ok) {
            return NextResponse.json({ success: false, error: eventParsed.error }, { status: 400 });
        }
        const eventInput = eventParsed?.ok ? eventParsed.value : null;

        const hasAccess = await checkTokenAccess(tokenInfo, partitionId, "create");
        if (!hasAccess) {
            return NextResponse.json({ success: false, error: "Access denied for this partition." }, { status: 403 });
        }

        const access = await verifyPartitionAccess(partitionId, tokenInfo.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "Partition not found." }, { status: 404 });
        }

        const partition = access.partition;

        // 생성 공통 경로 — 이벤트 기록은 생성·병합과 같은 트랜잭션에서 한다
        const result = await createRecord({
            orgId: tokenInfo.orgId,
            partition: toRecordCreatePartition(partition),
            data: recordData,
            source: "api",
            enforcePlanLimit: true,
            inTransaction: (tx, record) => eventInput
                ? insertRecordEvent({ orgId: tokenInfo.orgId, recordId: record.id, event: eventInput }, tx)
                : Promise.resolve(null),
        });

        if (result.status === "plan_limit") {
            return NextResponse.json({
                success: false,
                error: `Record limit (${result.limit}) exceeded. Plan upgrade required.`,
            }, { status: 403 });
        }
        if (result.status === "duplicate") {
            return NextResponse.json({
                success: false,
                error: `Duplicate data exists. (${result.field}: ${result.value})`,
            }, { status: 409 });
        }

        // 미연결 트래커 visitor 역매칭 (fire-after-commit, 실패해도 응답엔 영향 없음)
        rematchVisitorsByRecord({
            orgId: tokenInfo.orgId,
            workspaceId: partition.workspaceId,
            recordId: result.record.id,
            data: result.record.data as Record<string, unknown>,
        }).catch((err) => console.error("rematchVisitorsByRecord error:", err));

        if (result.status === "merged") {
            return NextResponse.json({ success: true, data: result.record, merged: true, event: result.extra ?? null });
        }

        return NextResponse.json({ success: true, data: result.record, event: result.extra ?? null }, { status: 201 });
    } catch (error) {
        console.error("External record create error:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
}

// ── CORS ──
// 외부 사이트(고객사)가 브라우저에서 직접 호출하는 공개 API라 CORS 허용.

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
    const res = await handlePost(req);
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.headers.set(k, v);
    }
    return res;
}
