import { addVisibleFieldKeys } from "@/lib/visible-fields";
import { NextRequest, NextResponse } from "next/server";
import { db, workspaces, fieldDefinitions, partitions } from "@/lib/db";
import { eq, and, max } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db/errors";

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
    const user = await getActiveUserFromNextRequest(req);
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
        // 건너뛴 줄과 이유 — 화면이 어떤 key를 왜 빼야 했는지 보여준다(문구는 단건 추가와 같다)
        const skippedItems: Array<{ key: string; reason: string }> = [];
        const skip = (key: unknown, reason: string) =>
            skippedItems.push({ key: typeof key === "string" ? key.trim() : "", reason });

        for (const f of fields) {
            const key = typeof f?.key === "string" ? f.key.trim() : "";
            if (!key) { skip(f?.key, "key를 입력해주세요."); continue; }
            if (typeof f.label !== "string" || !f.label.trim()) { skip(key, "라벨을 입력해주세요."); continue; }
            if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) { skip(key, "key는 영문으로 시작하고 영문과 숫자만 사용 가능합니다."); continue; }
            if (!f.fieldType || !VALID_FIELD_TYPES.includes(f.fieldType)) { skip(key, "유효하지 않은 필드 타입입니다."); continue; }
            if (existingKeys.has(key)) { skip(key, "이미 존재하는 key입니다."); continue; }
            // 같은 요청 안에서 같은 key가 다시 나오면 앞의 것만 만든다 — 고유 제약 위반으로 전체가 실패하지 않게
            existingKeys.add(key);
            fieldsToCreate.push(f);
        }
        const skippedCount = skippedItems.length;

        if (fieldsToCreate.length === 0) {
            return NextResponse.json({
                success: true,
                data: { created: 0, skipped: skippedCount, skippedItems, total: fields.length },
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
            // 전체 표시(null·빈 배열) 파티션은 그대로 둔다(UX-067)
            const nextFields = addVisibleFieldKeys(p.visibleFields as string[] | null, createdKeys);
            if (nextFields) {
                await db
                    .update(partitions)
                    .set({
                        visibleFields: nextFields,
                        updatedAt: new Date(),
                    })
                    .where(eq(partitions.id, p.id));
            }
        }

        return NextResponse.json({
            success: true,
            data: { created: createdKeys.length, skipped: skippedCount, skippedItems, total: fields.length },
        }, { status: 201 });
    } catch (error) {
        // 동시에 같은 key를 추가한 경우 — 트랜잭션이 통째로 취소되어 아무것도 만들어지지 않았다
        if (isUniqueViolation(error)) {
            return NextResponse.json({ success: false, error: "다른 사용자가 같은 key를 먼저 추가했습니다. 목록을 새로고침한 뒤 다시 시도해주세요." }, { status: 409 });
        }
        console.error("Bulk fields create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
