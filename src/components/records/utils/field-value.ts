/**
 * 레코드의 속성 값. 시스템 매핑 속성(등록일·수정일 등)은 data가 아니라 records의 시스템 컬럼에서 읽는다.
 * 목록 표와 상세 패널이 같은 규칙을 쓴다.
 */
export function recordFieldValue(
    record: { data: unknown },
    field: { key: string; systemColumn?: string | null },
): unknown {
    if (field.systemColumn)
        return (record as unknown as Record<string, unknown>)[field.systemColumn];
    return ((record.data ?? {}) as Record<string, unknown>)[field.key];
}
