import { NextRequest, NextResponse } from "next/server";
import { db, fieldTypes, fieldDefinitions, partitions, workspaces } from "@/lib/db";
import { eq, and, asc, max, or, isNull } from "drizzle-orm";
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

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const typeId = Number(id);

    const [type] = await db
        .select()
        .from(fieldTypes)
        .where(and(eq(fieldTypes.id, typeId), eq(fieldTypes.orgId, user.orgId)));

    if (!type) {
        return NextResponse.json({ success: false, error: "타입을 찾을 수 없습니다." }, { status: 404 });
    }

    const fields = await db
        .select()
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.fieldTypeId, typeId))
        .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.id));

    return NextResponse.json({ success: true, data: fields });
}

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
    const typeId = Number(id);

    const [type] = await db
        .select()
        .from(fieldTypes)
        .where(and(eq(fieldTypes.id, typeId), eq(fieldTypes.orgId, user.orgId)));

    if (!type) {
        return NextResponse.json({ success: false, error: "타입을 찾을 수 없습니다." }, { status: 404 });
    }

    const { key, label, fieldType, category, isRequired, isSortable, defaultValue, options, cellClassName } = await req.json();

    if (!key?.trim() || !label?.trim()) {
        return NextResponse.json({ success: false, error: "key와 라벨을 입력해주세요." }, { status: 400 });
    }
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key.trim())) {
        return NextResponse.json({ success: false, error: "key는 영문으로 시작하고 영문과 숫자만 사용 가능합니다." }, { status: 400 });
    }
    if (!fieldType || !VALID_FIELD_TYPES.includes(fieldType)) {
        return NextResponse.json({ success: false, error: "유효하지 않은 필드 타입입니다." }, { status: 400 });
    }

    try {
        const [maxResult] = await db
            .select({ maxSort: max(fieldDefinitions.sortOrder) })
            .from(fieldDefinitions)
            .where(eq(fieldDefinitions.fieldTypeId, typeId));

        const nextSortOrder = (maxResult?.maxSort ?? -1) + 1;
        const cellType = FIELD_TYPE_TO_CELL_TYPE[fieldType] || "editable";

        const [created] = await db
            .insert(fieldDefinitions)
            .values({
                fieldTypeId: typeId,
                key: key.trim(),
                label: label.trim(),
                fieldType,
                cellType,
                category: category?.trim() || null,
                isRequired: isRequired ? 1 : 0,
                isSortable: isSortable ? 1 : 0,
                isSystem: 0,
                sortOrder: nextSortOrder,
                defaultWidth: 120,
                minWidth: 80,
                defaultValue: defaultValue?.trim() || null,
                options: fieldType === "select" && options?.length ? options : null,
                cellClassName: cellClassName?.trim() || null,
            })
            .returning({ id: fieldDefinitions.id, key: fieldDefinitions.key, label: fieldDefinitions.label });

        // 이 타입을 사용하는 파티션들의 visibleFields에 새 key 추가
        const newKey = key.trim();

        // 1. fieldTypeId가 직접 이 타입인 파티션
        // 2. fieldTypeId가 null이고 워크스페이스의 defaultFieldTypeId가 이 타입인 파티션
        const affectedWorkspaces = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.defaultFieldTypeId, typeId), eq(workspaces.orgId, user.orgId)));

        const wsIds = affectedWorkspaces.map(w => w.id);

        const partitionList = await db
            .select({ id: partitions.id, visibleFields: partitions.visibleFields })
            .from(partitions)
            .where(
                or(
                    eq(partitions.fieldTypeId, typeId),
                    ...(wsIds.length > 0
                        ? wsIds.map(wsId =>
                            and(eq(partitions.workspaceId, wsId), isNull(partitions.fieldTypeId))
                        )
                        : [])
                )
            );

        for (const p of partitionList) {
            const currentFields = (p.visibleFields as string[]) || [];
            if (!currentFields.includes(newKey)) {
                await db
                    .update(partitions)
                    .set({
                        visibleFields: [...currentFields, newKey],
                        updatedAt: new Date(),
                    })
                    .where(eq(partitions.id, p.id));
            }
        }

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes("unique")) {
            return NextResponse.json({ success: false, error: "이미 존재하는 key입니다." }, { status: 409 });
        }
        console.error("Field create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
