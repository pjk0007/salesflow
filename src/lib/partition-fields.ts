import { eq } from "drizzle-orm";
import { fieldDefinitions } from "@/lib/db";

/**
 * 파티션이 쓰는 필드 정의 조건 — 파티션 타입 → 워크스페이스 기본 타입 → 워크스페이스 필드 순.
 * resolved-fields API·레코드 생성 필수 검사·채팅 알림이 같은 기준을 쓴다.
 */
export function partitionFieldsWhere(fieldTypeId: number | null, defaultFieldTypeId: number | null, workspaceId: number) {
    const typeId = fieldTypeId ?? defaultFieldTypeId;
    return typeId ? eq(fieldDefinitions.fieldTypeId, typeId) : eq(fieldDefinitions.workspaceId, workspaceId);
}
