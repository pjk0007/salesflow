import { fieldDefinitions, partitions, workspaces } from "@/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import type { RecordDb as Executor } from "@/lib/record-create";

/** 파티션이 쓰는 필드 타입 — 파티션 fieldTypeId → 워크스페이스 defaultFieldTypeId (resolved-fields API와 같은 기준) */
async function resolvePartitionFieldType(exec: Executor, partitionId: number) {
    const [partition] = await exec
        .select({
            fieldTypeId: partitions.fieldTypeId,
            wsFieldTypeId: workspaces.defaultFieldTypeId,
            workspaceId: partitions.workspaceId,
        })
        .from(partitions)
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(eq(partitions.id, partitionId));
    if (!partition) return null;
    return { typeId: partition.fieldTypeId || partition.wsFieldTypeId, workspaceId: partition.workspaceId };
}

/**
 * 파티션의 필드 정의에서 defaultValue가 설정된 필드의 기본값 맵을 돌려준다 (레코드 생성 시 빈 칸에만 적용).
 * 생성 트랜잭션 안에서 부를 수 있도록 실행기(db 또는 tx)를 받는다.
 */
export async function loadFieldDefaults(exec: Executor, partitionId: number): Promise<Record<string, string>> {
    const resolved = await resolvePartitionFieldType(exec, partitionId);
    if (!resolved?.typeId) return {};

    const fieldsWithDefaults = await exec
        .select({ key: fieldDefinitions.key, defaultValue: fieldDefinitions.defaultValue })
        .from(fieldDefinitions)
        .where(and(
            eq(fieldDefinitions.fieldTypeId, resolved.typeId),
            isNotNull(fieldDefinitions.defaultValue)
        ));

    const defaults: Record<string, string> = {};
    for (const field of fieldsWithDefaults) {
        if (field.defaultValue) defaults[field.key] = field.defaultValue;
    }
    return defaults;
}

/** 파티션에서 보이는 필드 이름(label). 없으면 key를 그대로 돌려준다 — 중복 거부 문구에 내부 key 대신 쓴다 (UX-066) */
export async function partitionFieldLabel(exec: Executor, partitionId: number, key: string): Promise<string> {
    const resolved = await resolvePartitionFieldType(exec, partitionId);
    if (!resolved) return key;
    const [field] = await exec
        .select({ label: fieldDefinitions.label })
        .from(fieldDefinitions)
        .where(and(
            resolved.typeId
                ? eq(fieldDefinitions.fieldTypeId, resolved.typeId)
                : eq(fieldDefinitions.workspaceId, resolved.workspaceId),
            eq(fieldDefinitions.key, key)
        ))
        .limit(1);
    return field?.label || key;
}

/** 파티션의 체크박스 필드 key — 파일 업로드 값을 boolean으로 정규화할 때 쓴다 (UX-046) */
export async function partitionCheckboxKeys(exec: Executor, partitionId: number): Promise<Set<string>> {
    const resolved = await resolvePartitionFieldType(exec, partitionId);
    if (!resolved) return new Set();
    const rows = await exec
        .select({ key: fieldDefinitions.key })
        .from(fieldDefinitions)
        .where(and(
            resolved.typeId
                ? eq(fieldDefinitions.fieldTypeId, resolved.typeId)
                : eq(fieldDefinitions.workspaceId, resolved.workspaceId),
            eq(fieldDefinitions.fieldType, "checkbox")
        ));
    return new Set(rows.map((r) => r.key));
}
