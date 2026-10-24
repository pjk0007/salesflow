import { db, records, organizations, type DbRecord, type partitions } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { assignDistributionOrder } from "@/lib/distribution";
import { loadFieldDefaults, partitionFieldLabel } from "@/lib/apply-field-defaults";
import { checkPlanLimit, getResourceCount } from "@/lib/billing";
import { dispatchAutoTriggers } from "@/lib/automation-dispatch";
import { processAutoEnrich } from "@/lib/auto-enrich";
import { broadcastToPartition } from "@/lib/sse";
import { notifyRecordChatAlert } from "@/lib/record-chat-alert/notify";
import type { RecordAlertSource } from "@/lib/record-chat-alert/rules";

/**
 * 레코드 생성 공통 경로 (T10) — 화면·웹 폼·외부 API(v1)·Meta 광고·MCP가 같은 함수로 만든다.
 * 계약 문서: 작업 기록 work/F4/CONTRACTS-F4.md
 *
 * 트랜잭션 안: 중복 정책(거부/허용/병합/교체) → 통합코드 발번(UPDATE … RETURNING) → 분배 번호 → 기본값 병합 → insert
 * 커밋 후 한 번: 자동화(알림톡·이메일·AI 개인화) + 자동 보강 + 구글챗 알림(고객 유입 경로만) + SSE
 */

/** 생성 단계에 필요한 최소 실행기 — db와 트랜잭션(tx) 둘 다 받는다 */
export type RecordDb = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;
/** 트랜잭션을 열 수 있는 실행기 (기본 db) */
export type RecordDbRoot = RecordDb & Pick<typeof db, "transaction">;

/** 유입 경로. 구글챗 알림은 고객 행동으로 생긴 경로(web_form·api·meta_ad)만 보낸다 */
export type RecordCreateSource = "screen" | "web_form" | "api" | "meta_ad" | "mcp";

export interface RecordCreatePartition {
    id: number;
    workspaceId: number;
    duplicateConfig: { field: string; action: string } | null;
    duplicateCheckField: string | null;
}

/** 파티션 행에서 생성에 필요한 값만 꺼낸다 */
export function toRecordCreatePartition(
    p: Pick<typeof partitions.$inferSelect, "id" | "workspaceId" | "duplicateConfig" | "duplicateCheckField">
): RecordCreatePartition {
    return { id: p.id, workspaceId: p.workspaceId, duplicateConfig: p.duplicateConfig ?? null, duplicateCheckField: p.duplicateCheckField };
}

export interface CreateRecordInput<E = null> {
    orgId: string;
    partition: RecordCreatePartition;
    /** 입력값. 빈 값(undefined·null·"")이 아닌 값이 모든 기본값보다 우선한다 */
    data: Record<string, unknown>;
    source: RecordCreateSource;
    /** 폼·광고 연동의 기본값 — 새로 만들 때 빈 칸에만 채운다(병합 때는 쓰지 않는다) */
    sourceDefaults?: Record<string, unknown>;
    /** 요금제 레코드 한도 확인 (화면·v1·MCP는 true, 리드 유실이 더 비싼 웹 폼·Meta는 false) */
    enforcePlanLimit?: boolean;
    /** SSE에서 제외할 요청자 세션 (화면 추가 시 자기 목록 중복 갱신 방지) */
    sessionId?: string;
    /** 같은 트랜잭션에서 함께 쓸 일 (예: v1 이벤트 기록). 실패하면 레코드 생성도 취소된다 */
    inTransaction?: (tx: RecordDb, record: DbRecord, kind: "created" | "merged") => Promise<E>;
}

export type CreateRecordResult<E = null> =
    | { status: "created"; record: DbRecord; extra: E }
    | { status: "merged"; record: DbRecord; extra: E }
    | { status: "duplicate"; field: string; fieldLabel: string; value: string; existingRecordId: number }
    | { status: "plan_limit"; limit: number };

export interface RecordCreateEffects {
    dispatchAutoTriggers: typeof dispatchAutoTriggers;
    processAutoEnrich: typeof processAutoEnrich;
    notifyRecordChatAlert: typeof notifyRecordChatAlert;
    broadcastToPartition: typeof broadcastToPartition;
}

export interface RecordCreateDeps {
    db: RecordDbRoot;
    effects: RecordCreateEffects;
    planLimit: (orgId: string) => Promise<{ allowed: boolean; limit: number }>;
}

const defaultDeps: RecordCreateDeps = {
    db,
    effects: { dispatchAutoTriggers, processAutoEnrich, notifyRecordChatAlert, broadcastToPartition },
    planLimit: async (orgId) => checkPlanLimit(orgId, "records", await getResourceCount(orgId, "records")),
};

const CHAT_ALERT_SOURCES: Partial<Record<RecordCreateSource, RecordAlertSource>> = {
    web_form: "web_form",
    api: "api",
    meta_ad: "meta_ad",
};

export function isBlankValue(value: unknown): boolean {
    return value === undefined || value === null || value === "";
}

export function formatIntegratedCode(prefix: string, seq: number): string {
    return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/**
 * 통합코드 count개를 원자적으로 예약한다 — UPDATE … SET seq = seq + count RETURNING (UX-038·071).
 * 같은 트랜잭션에서 부르면 커밋까지 조직 행이 잠겨 동시 발번이 순서대로 줄을 선다.
 */
export async function reserveIntegratedCodes(exec: RecordDb, orgId: string, count: number): Promise<string[]> {
    if (count <= 0) return [];
    const [row] = await exec
        .update(organizations)
        .set({ integratedCodeSeq: sql`${organizations.integratedCodeSeq} + ${count}::int4` })
        .where(eq(organizations.id, orgId))
        .returning({ seq: organizations.integratedCodeSeq, prefix: organizations.integratedCodePrefix });
    if (!row) throw new Error(`통합코드를 발번할 조직을 찾을 수 없습니다: ${orgId}`);
    const first = row.seq - count + 1;
    return Array.from({ length: count }, (_, i) => formatIntegratedCode(row.prefix, first + i));
}

/**
 * 새 레코드 data 병합 규칙 — 입력값 > 폼·연동 기본값 > 분배 순번 기본값 > 필드 기본값.
 * 앞 단계 값이 비어 있을 때만 다음 단계 값으로 채운다 (UX-037 R1: 분배가 필드 기본값을 지우지 않게).
 */
export function buildCreateData(
    input: Record<string, unknown>,
    ...defaultLayers: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
    const result: Record<string, unknown> = { ...input };
    for (const layer of defaultLayers) {
        if (!layer) continue;
        for (const [key, value] of Object.entries(layer)) {
            if (isBlankValue(value)) continue;
            if (isBlankValue(result[key])) result[key] = value;
        }
    }
    return result;
}

export function duplicateFieldOf(partition: RecordCreatePartition): { field: string | null; action: string } {
    return {
        field: partition.duplicateConfig?.field || partition.duplicateCheckField || null,
        action: partition.duplicateConfig?.action || "reject",
    };
}

type TxOutcome<E> =
    | { status: "created" | "merged"; record: DbRecord; extra: E }
    | { status: "duplicate"; field: string; value: string; existingRecordId: number };

export async function createRecord<E = null>(
    input: CreateRecordInput<E>,
    overrides: Partial<RecordCreateDeps> = {}
): Promise<CreateRecordResult<E>> {
    const deps = { ...defaultDeps, ...overrides };
    const { orgId, partition, data, source } = input;

    if (input.enforcePlanLimit) {
        const limit = await deps.planLimit(orgId);
        if (!limit.allowed) return { status: "plan_limit", limit: limit.limit };
    }

    const dup = duplicateFieldOf(partition);
    const dupValue = dup.field ? data[dup.field] : undefined;
    const runExtra = async (tx: RecordDb, record: DbRecord, kind: "created" | "merged") =>
        (input.inTransaction ? await input.inTransaction(tx, record, kind) : null) as E;

    const outcome = await deps.db.transaction(async (tx): Promise<TxOutcome<E>> => {
        if (dup.field && dupValue) {
            const value = String(dupValue);
            // 같은 값의 동시 제출이 둘 다 '중복 없음'으로 통과하지 않도록 파티션·값 단위로 줄을 세운다
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${partition.id}::int4, hashtext(${`${dup.field}:${value}`}::text))`);
            const [duplicate] = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(
                    eq(records.partitionId, partition.id),
                    eq(records.orgId, orgId),
                    sql`${records.data}->>${dup.field} = ${value}`
                ))
                .limit(1);

            if (duplicate) {
                switch (dup.action) {
                    case "allow":
                        break;
                    case "merge": {
                        const mergedData = { ...(duplicate.data as Record<string, unknown>), ...data };
                        const [merged] = await tx
                            .update(records)
                            .set({ data: mergedData, updatedAt: new Date() })
                            .where(eq(records.id, duplicate.id))
                            .returning();
                        return { status: "merged", record: merged, extra: await runExtra(tx, merged, "merged") };
                    }
                    case "delete_old":
                        // 교체: 같은 트랜잭션에서 지우므로 생성이 실패하면 기존 레코드도 남는다 (UX-066)
                        await tx.delete(records).where(eq(records.id, duplicate.id));
                        break;
                    default:
                        return { status: "duplicate", field: dup.field, value, existingRecordId: duplicate.id };
                }
            }
        }

        const [integratedCode] = await reserveIntegratedCodes(tx, orgId, 1);
        const distribution = await assignDistributionOrder(tx, partition.id);
        const fieldDefaults = await loadFieldDefaults(tx, partition.id);
        const finalData = buildCreateData(data, input.sourceDefaults, distribution?.defaults, fieldDefaults);

        const [created] = await tx
            .insert(records)
            .values({
                orgId,
                workspaceId: partition.workspaceId,
                partitionId: partition.id,
                integratedCode,
                distributionOrder: distribution?.distributionOrder ?? null,
                data: finalData,
            })
            .returning();

        return { status: "created", record: created, extra: await runExtra(tx, created, "created") };
    });

    if (outcome.status === "duplicate") {
        const fieldLabel = await partitionFieldLabel(deps.db, partition.id, outcome.field).catch(() => outcome.field);
        return { ...outcome, fieldLabel };
    }

    runRecordEffects(deps.effects, outcome.record, outcome.status, {
        source,
        partitionId: partition.id,
        orgId,
        sessionId: input.sessionId,
    });
    return outcome;
}

function logEffectFailure(effect: string, record: DbRecord, source: RecordCreateSource, err: unknown) {
    console.error(`[record-create] ${effect} 실패 (record=${record.id}, partition=${record.partitionId}, source=${source}):`, err);
}

/**
 * 커밋 후 후처리 — 생성·병합 한 건당 정확히 한 번. 각 단계는 서로 독립이며 실패는 같은 형식으로 기록하고 응답을 막지 않는다.
 * - created: 자동화(on_create) + 자동 보강 + 구글챗 '신규 접수'(고객 유입 경로만) + SSE record:created
 * - merged: 구글챗 '재접수'(고객 유입 경로만) + SSE record:updated (병합은 새 리드가 아니므로 on_create 자동화는 돌리지 않는다)
 */
export function runRecordEffects(
    effects: RecordCreateEffects,
    record: DbRecord,
    kind: "created" | "merged",
    ctx: { source: RecordCreateSource; partitionId: number; orgId: string; sessionId?: string }
): void {
    const { source, partitionId, orgId } = ctx;
    const guard = (effect: string, run: () => void | Promise<unknown>) => {
        try {
            const pending = run();
            if (pending) pending.catch((err) => logEffectFailure(effect, record, source, err));
        } catch (err) {
            logEffectFailure(effect, record, source, err);
        }
    };

    if (kind === "created") {
        const params = { record, partitionId, triggerType: "on_create" as const, orgId };
        guard("자동화", () => effects.dispatchAutoTriggers(params));
        guard("자동 보강", () => effects.processAutoEnrich(params));
    }

    const chatSource = CHAT_ALERT_SOURCES[source];
    if (chatSource) {
        guard("구글챗 알림", () => effects.notifyRecordChatAlert({ recordId: record.id, source: chatSource, kind }));
    }

    guard("실시간 갱신", () => effects.broadcastToPartition(
        partitionId,
        kind === "created" ? "record:created" : "record:updated",
        { partitionId, recordId: record.id },
        ctx.sessionId
    ));
}
