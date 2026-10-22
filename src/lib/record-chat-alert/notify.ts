import { db, records, partitions, workspaces, chatSpaces, fieldDefinitions } from "@/lib/db";
import { and, asc, eq } from "drizzle-orm";
import { postGoogleChatText } from "@/lib/google-chat";
import {
    buildRecordAlertText,
    pickAlertFields,
    recordThreadKey,
    type RecordAlertKind,
    type RecordAlertSource,
} from "./rules";

function baseUrl(): string {
    return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://sendb.kr").replace(/\/$/, "");
}

/** 파티션이 쓰는 필드 정의 — 파티션 타입 → 워크스페이스 기본 타입 → 워크스페이스 필드 순 (resolved-fields API와 같은 기준) */
async function resolveFields(fieldTypeId: number | null, defaultFieldTypeId: number | null, workspaceId: number) {
    const typeId = fieldTypeId ?? defaultFieldTypeId;
    return db
        .select({
            key: fieldDefinitions.key,
            label: fieldDefinitions.label,
            fieldType: fieldDefinitions.fieldType,
            isSystem: fieldDefinitions.isSystem,
        })
        .from(fieldDefinitions)
        .where(typeId ? eq(fieldDefinitions.fieldTypeId, typeId) : eq(fieldDefinitions.workspaceId, workspaceId))
        .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.id));
}

/**
 * 고객 행동으로 생긴(또는 중복 병합된) 레코드를 파티션의 구글챗 스페이스에 알린다.
 * 파티션에 스페이스가 없으면 아무것도 하지 않는다. 레코드 저장을 막지 않도록 부른 쪽은 기다리지 않고 .catch만 건다.
 */
export async function notifyRecordChatAlert(input: {
    recordId: number;
    source: RecordAlertSource;
    kind?: RecordAlertKind;
}): Promise<void> {
    const [row] = await db
        .select({
            data: records.data,
            integratedCode: records.integratedCode,
            partitionName: partitions.name,
            fieldTypeId: partitions.fieldTypeId,
            workspaceId: workspaces.id,
            workspaceName: workspaces.name,
            defaultFieldTypeId: workspaces.defaultFieldTypeId,
            webhookUrl: chatSpaces.webhookUrl,
        })
        .from(records)
        .innerJoin(partitions, eq(partitions.id, records.partitionId))
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        // 스페이스가 다른 조직 것이면 보내지 않는다
        .innerJoin(chatSpaces, and(eq(chatSpaces.id, partitions.chatSpaceId), eq(chatSpaces.orgId, records.orgId)))
        .where(eq(records.id, input.recordId))
        .limit(1);
    if (!row) return;

    const fields = await resolveFields(row.fieldTypeId, row.defaultFieldTypeId, row.workspaceId);
    const text = buildRecordAlertText({
        kind: input.kind ?? "created",
        source: input.source,
        workspaceName: row.workspaceName,
        partitionName: row.partitionName,
        integratedCode: row.integratedCode,
        fields: pickAlertFields((row.data as Record<string, unknown>) ?? {}, fields),
        recordUrl: `${baseUrl()}/records?id=${input.recordId}`,
    });

    const result = await postGoogleChatText(row.webhookUrl, text, fetch, {
        threadKey: recordThreadKey(input.recordId),
    });
    if (!result.ok) {
        console.error(`[record-chat-alert] record ${input.recordId} 알림 실패: ${result.error}`);
    }
}
