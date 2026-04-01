import { db } from "@/lib/db";
import { fieldDefinitions, partitions, workspaces, fieldTypes } from "@/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";

/**
 * 파티션의 필드 정의에서 defaultValue가 설정된 필드를 찾아
 * data에 해당 key가 비어있으면 기본값을 적용합니다.
 */
export async function applyFieldDefaults(
    partitionId: number,
    data: Record<string, unknown>
): Promise<Record<string, unknown>> {
    try {
        // 파티션의 fieldTypeId 또는 워크스페이스의 defaultFieldTypeId 조회
        const [partition] = await db
            .select({
                fieldTypeId: partitions.fieldTypeId,
                wsFieldTypeId: workspaces.defaultFieldTypeId,
            })
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(eq(partitions.id, partitionId));

        if (!partition) return data;

        const typeId = partition.fieldTypeId || partition.wsFieldTypeId;
        if (!typeId) return data;

        // defaultValue가 설정된 필드 조회
        const fieldsWithDefaults = await db
            .select({ key: fieldDefinitions.key, defaultValue: fieldDefinitions.defaultValue })
            .from(fieldDefinitions)
            .where(and(
                eq(fieldDefinitions.fieldTypeId, typeId),
                isNotNull(fieldDefinitions.defaultValue)
            ));

        const result = { ...data };
        for (const field of fieldsWithDefaults) {
            if (field.defaultValue && (result[field.key] === undefined || result[field.key] === null || result[field.key] === "")) {
                result[field.key] = field.defaultValue;
            }
        }

        return result;
    } catch (err) {
        console.error("applyFieldDefaults error:", err);
        return data;
    }
}
