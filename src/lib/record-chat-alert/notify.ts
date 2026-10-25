import { randomUUID } from "node:crypto";
import { db, records, partitions, workspaces, chatSpaces, fieldDefinitions } from "@/lib/db";
import { and, asc, eq } from "drizzle-orm";
import { chatFixedMessageIdEnabled, chatMessageIdFor, postGoogleChatText, type GoogleChatResult } from "@/lib/google-chat";
import { scrubWebhook } from "@/lib/deep-visitor-alert-delivery";
import { insertRecordEvent } from "@/lib/record-events";
import { partitionFieldsWhere } from "@/lib/partition-fields";
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
    return db
        .select({
            key: fieldDefinitions.key,
            label: fieldDefinitions.label,
            fieldType: fieldDefinitions.fieldType,
            isSystem: fieldDefinitions.isSystem,
        })
        .from(fieldDefinitions)
        .where(partitionFieldsWhere(fieldTypeId, defaultFieldTypeId, workspaceId))
        .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.id));
}

/**
 * 응답 뒤 보내기(postGoogleChatText 안의 짧은 재시도 1~2회)로도 못 보낸 알림을 이 간격으로 더 보낸다 (UX-287).
 * 새 큐 테이블 없이 프로세스 안에서 기다린다 — 그 사이 서버가 재시작되면 남은 재시도는 사라진다.
 */
export const CHAT_ALERT_RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000];

/** 끝내 못 보낸 알림을 레코드 이력에 남기는 이벤트 — 여정·레코드 이력에서 보인다. 단계 계산 대상이 아니다 */
export const CHAT_ALERT_FAILED_EVENT = { type: "chat_alert_failed", label: "구글챗 알림 실패" } as const;

export interface ChatAlertDeliveryDeps {
    post: () => Promise<GoogleChatResult>;
    wait: (ms: number) => Promise<void>;
    /** 최종 실패 기록 (레코드 이력) */
    recordFailure: (failure: { error: string; status: number | null; attempts: number }) => Promise<void>;
    /** 고정 messageId를 붙여 보내 같은 알림이 두 번 올라가지 않는다 — 시간 초과 뒤에도 다시 보낼 수 있다 */
    idempotent: boolean;
}

/**
 * 알림 한 건 보내기 — 일시 실패(429·5xx·연결)는 지연 재시도, 그래도 안 되거나 다시 보내도 소용없는 실패(웹훅 삭제·권한)는
 * 레코드 이력에 남긴다. 시간 초과는 이미 올라갔을 수 있어 고정 messageId가 없으면 다시 보내지 않고 '확인 필요'로 남긴다.
 */
export async function deliverRecordChatAlert(
    deps: ChatAlertDeliveryDeps,
    retryDelays: readonly number[] = CHAT_ALERT_RETRY_DELAYS_MS
): Promise<{ ok: boolean; attempts: number }> {
    let attempts = 0;
    for (;;) {
        attempts++;
        const result = await deps.post();
        if (result.ok) return { ok: true, attempts };
        const delay = retryDelays[attempts - 1];
        const uncertainStop = result.uncertain === true && !deps.idempotent;
        if (!result.retryable || delay === undefined || uncertainStop) {
            const error = uncertainStop
                ? `${result.error} — 응답이 없어 다시 보내지 않았습니다. 스페이스에 올라갔는지 확인해주세요.`
                : result.error;
            await deps.recordFailure({ error, status: result.status, attempts });
            return { ok: false, attempts };
        }
        await deps.wait(delay);
    }
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
            orgId: records.orgId,
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

    const kind = input.kind ?? "created";
    // 알림 한 건마다 고정 messageId 하나 — 재시도해도 구글이 같은 메시지를 한 번만 만든다 (GOOGLE_CHAT_REQUEST_ID=on일 때, UX-221 계약)
    const messageId = chatFixedMessageIdEnabled(process.env)
        ? chatMessageIdFor(process.env, "record", `${input.recordId}:${kind}:${randomUUID()}`)
        : undefined;
    await deliverRecordChatAlert({
        idempotent: messageId !== undefined,
        post: () => postGoogleChatText(row.webhookUrl, text, fetch, {
            threadKey: recordThreadKey(input.recordId),
            messageId,
        }),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        recordFailure: async ({ error, status, attempts }) => {
            const safeError = scrubWebhook(error, row.webhookUrl).slice(0, 300);
            console.error(`[record-chat-alert] record ${input.recordId} 알림 실패(${attempts}회): ${safeError}`);
            await insertRecordEvent({
                orgId: row.orgId,
                recordId: input.recordId,
                event: {
                    ...CHAT_ALERT_FAILED_EVENT,
                    occurredAt: new Date(),
                    meta: { source: input.source, kind, attempts, status, error: safeError },
                },
            });
        },
    });
}
