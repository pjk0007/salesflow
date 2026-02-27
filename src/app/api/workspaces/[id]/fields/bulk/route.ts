import { NextRequest, NextResponse } from "next/server";
import { db, workspaces, fieldDefinitions, partitions } from "@/lib/db";
import { eq, and, max } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

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

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const workspaceId = Number(id);
    if (!workspaceId) {
        return NextResponse.json({ success: false, error: "워크스페이스 ID가 필요합니다." }, { status: 400 });
    }

    const { fields } = await req.json();
    if (!Array.isArray(fields) || fields.length === 0) {
        return NextResponse.json({ success: false, error: "fields 배열이 필요합니다." }, { status: 400 });
    }

    try {
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
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
            return NextResponse.json({
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

        return NextResponse.json({
            success: true,
            data: { created: createdKeys.length, skipped: skippedCount, total: fields.length },
        }, { status: 201 });
    } catch (error) {
        console.error("Bulk fields create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
