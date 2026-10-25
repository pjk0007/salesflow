import { NextRequest, NextResponse } from "next/server";
import { db, records, fieldDefinitions, memos } from "@/lib/db";
import { eq, and, sql, desc, asc, count } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import { createRecord, toRecordCreatePartition } from "@/lib/record-create";
import { buildRecordConditions } from "@/lib/record-filters";

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

        const searchParams = req.nextUrl.searchParams;
        const page = Math.max(1, Number(searchParams.get("page")) || 1);
        const pageSize = Math.min(1000, Math.max(1, Number(searchParams.get("pageSize")) || 50));
        const search = searchParams.get("search") || "";
        const distributionOrder = searchParams.get("distributionOrder")
            ? Number(searchParams.get("distributionOrder"))
            : undefined;
        const sortField = searchParams.get("sortField") || "registeredAt";
        const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
        const groupBy = searchParams.get("groupBy");
        const groupValue = searchParams.get("groupValue");

        // filters 파싱
        let filters: Array<{ field: string; operator: string; value: unknown; valueTo?: unknown }> = [];
        const filtersParam = searchParams.get("filters");
        if (filtersParam) {
            try {
                filters = JSON.parse(filtersParam);
            } catch { /* 무시 */ }
        }

        const offset = (page - 1) * pageSize;

        // WHERE 조건 구성 (목록/조건삭제 공용 빌더)
        const conditions = buildRecordConditions(partitionId, { search, distributionOrder, groupBy, groupValue, filters });

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
            // JSONB data 필드: 타입에 따라 캐스팅하여 정렬
            // 파티션 fieldTypeId → 워크스페이스 defaultFieldTypeId → workspaceId 폴백
            const resolvedTypeId = access.partition.fieldTypeId ?? access.workspace.defaultFieldTypeId;
            const [fieldDef] = await db
                .select({ fieldType: fieldDefinitions.fieldType })
                .from(fieldDefinitions)
                .where(
                    and(
                        resolvedTypeId
                            ? eq(fieldDefinitions.fieldTypeId, resolvedTypeId)
                            : eq(fieldDefinitions.workspaceId, access.partition.workspaceId),
                        eq(fieldDefinitions.key, sortField)
                    )
                );

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

        // 총 건수
        const [totalResult] = await db
            .select({ value: count() })
            .from(records)
            .where(whereClause);
        const total = totalResult?.value ?? 0;

        // 레코드 목록 (댓글 수 포함)
        const memoCountSq = db
            .select({ recordId: memos.recordId, cnt: count().as("cnt") })
            .from(memos)
            .groupBy(memos.recordId)
            .as("memo_count");

        const data = await db
            .select({
                id: records.id,
                orgId: records.orgId,
                workspaceId: records.workspaceId,
                partitionId: records.partitionId,
                integratedCode: records.integratedCode,
                data: records.data,
                distributionOrder: records.distributionOrder,
                registeredAt: records.registeredAt,
                createdAt: records.createdAt,
                updatedAt: records.updatedAt,
                memoCount: sql<number>`COALESCE(${memoCountSq.cnt}, 0)`.as("memo_count"),
            })
            .from(records)
            .leftJoin(memoCountSq, eq(records.id, memoCountSq.recordId))
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
    const user = await getActiveUserFromNextRequest(req);
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
        const access = await requirePartitionAccess(user, partitionId, "create");
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        // 생성 공통 경로: 한도 → 중복 정책 → 발번·분배·기본값·insert(한 트랜잭션) → 커밋 후 후처리
        const result = await createRecord({
            orgId: user.orgId,
            partition: toRecordCreatePartition(access.partition),
            data: recordData,
            source: "screen",
            enforcePlanLimit: true,
            sessionId: req.headers.get("x-session-id") ?? undefined,
        });

        if (result.status === "plan_limit") {
            return NextResponse.json({
                success: false,
                error: `레코드 한도(${result.limit}건)를 초과했습니다. 플랜 업그레이드가 필요합니다.`,
                upgradeRequired: true,
            }, { status: 403 });
        }
        if (result.status === "duplicate") {
            return NextResponse.json({
                success: false,
                error: `중복된 데이터가 존재합니다. (${result.fieldLabel}: ${result.value})`,
            }, { status: 409 });
        }
        if (result.status === "merged") {
            // 새 레코드를 만들지 않고 기존 레코드에 합쳤다 — 화면은 merged로 '등록'과 다른 안내를 띄운다
            return NextResponse.json({ success: true, data: result.record, merged: true });
        }

        return NextResponse.json({ success: true, data: result.record }, { status: 201 });
    } catch (error) {
        console.error("Record create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
