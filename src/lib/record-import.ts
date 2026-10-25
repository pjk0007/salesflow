import {
    db,
    records,
    alimtalkTemplateLinks,
    emailTemplateLinks,
    emailAutoPersonalizedLinks,
    recordAutoEnrichRules,
    type DbRecord,
} from "@/lib/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { processAutoTriggerBatch } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { processAutoEnrich } from "@/lib/auto-enrich";
import { enqueueSends, wakeSendQueue } from "@/lib/email-send-queue";
import { reserveIntegratedCodes, isBlankValue, type RecordDb } from "@/lib/record-create";

// db 트랜잭션 / db 둘 다 받을 수 있는 최소 실행기 타입
type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

export interface ImportPartitionInfo {
    id: number;
    workspaceId: number;
    duplicateConfig: { field: string; action: string } | null;
    duplicateCheckField: string | null;
}

export interface InsertImportedRecordsParams {
    orgId: string;
    partition: ImportPartitionInfo;
    dataRows: Array<Record<string, unknown>>;
    /** 중복(reject) 시 동작 — skip(건너뛰기) | error(에러로 보고) */
    duplicateAction?: "skip" | "error";
    /** 진행률 콜백 (처리된 행 수, 전체) — 약 50행마다 + 완료 시 호출 */
    onProgress?: (processed: number, total: number) => void;
    /**
     * 통합코드 범위를 예약할 실행기. 기본은 트랜잭션 밖 풀 연결(db) — 가져오기 트랜잭션 내내 조직 행을 잠그면
     * 그동안 웹 폼·API 단건 생성이 모두 기다리므로 짧은 단일 문장으로 끝낸다. 롤백되면 예약한 번호만 비어 남는다.
     */
    codeExecutor?: RecordDb;
}

export interface InsertImportedRecordsResult {
    totalCount: number;
    insertedCount: number;
    skippedCount: number;
    mergedCount: number;
    errors: Array<{ row: number; message: string }>;
    insertedRecords: DbRecord[];
}

type ImportRowPlan =
    | { kind: "insert"; deleteExistingId?: number }
    | { kind: "merge"; existingId: number }
    | { kind: "skip" }
    | { kind: "error"; message: string };

/**
 * 행별 처리 계획 — DB를 쓰지 않고 파티션 중복 정책(reject/allow/merge/delete_old)을 먼저 정한다.
 * 실제 생성할 행 수를 알아야 통합코드를 그만큼만 원자적으로 예약할 수 있다 (UX-071).
 */
export function planImportRows(
    dataRows: Array<Record<string, unknown>>,
    existing: Array<{ id: number; val: string | null }>,
    duplicateField: string | null,
    dupAction: string,
    duplicateAction: "skip" | "error",
): ImportRowPlan[] {
    // 기존 레코드 값 → ID 매핑 (merge/delete_old용)
    const existingMap = new Map<string, number>();
    for (const r of existing) {
        if (r.val) {
            existingMap.set(r.val, r.id);
        }
    }
    const batchValues = new Set<string>();

    return dataRows.map((data): ImportRowPlan => {
        if (!duplicateField || isBlankValue(data[duplicateField])) return { kind: "insert" };

        const val = String(data[duplicateField]);
        const isDupExisting = existingMap.has(val);
        const isDupBatch = batchValues.has(val);
        let plan: ImportRowPlan = { kind: "insert" };

        if (isDupExisting || isDupBatch) {
            if (dupAction === "allow") {
                // 그대로 진행 (중복 허용)
            } else if (dupAction === "merge" && isDupExisting) {
                return { kind: "merge", existingId: existingMap.get(val)! };
            } else if (dupAction === "delete_old" && isDupExisting) {
                plan = { kind: "insert", deleteExistingId: existingMap.get(val)! };
                existingMap.delete(val);
            } else if (duplicateAction === "skip") {
                return { kind: "skip" };
            } else {
                return { kind: "error", message: `중복: ${duplicateField}="${val}"` };
            }
        }
        batchValues.add(val);
        return plan;
    });
}

/**
 * 가져오기/예약등록 공용 — 데이터 행들을 레코드로 생성한다.
 * 파티션 중복 정책 처리 + 통합코드 범위 예약(UPDATE … + n RETURNING) + insert.
 * 반드시 트랜잭션(tx) 안에서 호출할 것. 트리거는 호출하지 않는다(=dispatchImportTriggers 별도).
 * 단건 생성 경로(createRecord)와 같은 발번 함수를 쓴다. 분배·필드 기본값은 기존처럼 적용하지 않는다(파일 값 그대로).
 */
export async function insertImportedRecords(
    tx: DbExecutor,
    { orgId, partition, dataRows, duplicateAction = "skip", onProgress, codeExecutor = db }: InsertImportedRecordsParams,
): Promise<InsertImportedRecordsResult> {
    const partitionId = partition.id;

    // 중복 체크 필드 (duplicateConfig 우선, fallback to duplicateCheckField)
    const dupConfig = partition.duplicateConfig;
    const duplicateField = dupConfig?.field || partition.duplicateCheckField;
    const dupAction = dupConfig?.action || "reject"; // reject=skip/error, allow/merge/delete_old

    const duplicateValues = duplicateField
        ? [...new Set(dataRows.filter((data) => !isBlankValue(data[duplicateField])).map((data) => String(data[duplicateField])))]
        : [];
    if (duplicateField && duplicateValues.length) {
        // 단건 생성과 같은 키를 한 번의 SQL에서 정렬해 잠근다. 동시에 들어온 같은 값도 중복 조회 이후 끼어들지 못한다.
        const keys = sql.join(duplicateValues.map((value) => sql`${`${duplicateField}:${value}`}`), sql`, `);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${partitionId}::int4, k)
            FROM (SELECT DISTINCT hashtext(value) AS k FROM unnest(ARRAY[${keys}]::text[]) AS input(value) ORDER BY k) AS locks`);
    }
    const existing = duplicateField && duplicateValues.length
        ? await tx
            .select({ id: records.id, val: sql<string>`${records.data}->>${duplicateField}` })
            .from(records)
            .where(and(eq(records.partitionId, partitionId), eq(records.orgId, orgId), inArray(sql`${records.data}->>${duplicateField}`, duplicateValues)))
        : [];

    const plans = planImportRows(dataRows, existing, duplicateField, dupAction, duplicateAction);
    const codes = await reserveIntegratedCodes(codeExecutor, orgId, plans.filter((p) => p.kind === "insert").length);

    const errors: Array<{ row: number; message: string }> = [];
    const insertedRecords: DbRecord[] = [];
    let skippedCount = 0;
    let mergedCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
        if (onProgress && i % 50 === 0) onProgress(i, dataRows.length);
        const plan = plans[i];

        if (plan.kind === "skip") {
            skippedCount++;
            continue;
        }
        if (plan.kind === "error") {
            errors.push({ row: i + 1, message: plan.message });
            continue;
        }
        if (plan.kind === "merge") {
            await tx
                .update(records)
                .set({ data: sql`COALESCE(${records.data}, '{}'::jsonb) || ${JSON.stringify(dataRows[i])}::jsonb`, updatedAt: new Date() })
                .where(eq(records.id, plan.existingId));
            mergedCount++;
            continue;
        }
        if (plan.deleteExistingId) {
            await tx.delete(records).where(eq(records.id, plan.deleteExistingId));
        }

        const [inserted] = await tx.insert(records).values({
            orgId,
            workspaceId: partition.workspaceId,
            partitionId,
            integratedCode: codes[insertedRecords.length],
            data: dataRows[i],
        }).returning();
        insertedRecords.push(inserted);
    }

    if (onProgress) onProgress(dataRows.length, dataRows.length);

    return { totalCount: dataRows.length, insertedCount: insertedRecords.length, skippedCount, mergedCount, errors, insertedRecords };
}

/**
 * 가져오기/예약등록 공용 — 생성된 레코드들에 대해 자동 트리거를 발동한다.
 *
 * 핵심: 파티션에 활성 규칙이 있는지 **1회만** 확인하고, 규칙이 있는 트리거만 레코드별로 돈다.
 * (규칙이 없으면 레코드마다 조회·로그가 폭주하던 문제 방지 — 대량 가져오기 시 수천 줄 로그/쿼리 제거.)
 *
 * 알림톡/이메일/보강은 fire-and-forget, AI 개인화 메일은 큐에 적재만 하고 워커가 발송한다.
 */
export async function dispatchImportTriggers(
    insertedRecords: DbRecord[],
    ctx: { partitionId: number; orgId: string },
): Promise<void> {
    if (insertedRecords.length === 0) return;
    const p = ctx.partitionId;

    // 각 트리거 함수가 레코드별로 쓰는 것과 동일한 조건으로 "활성 규칙 존재" 1회 확인
    const [alim, emailAuto, aiEmail, enrich] = await Promise.all([
        db.select({ id: alimtalkTemplateLinks.id }).from(alimtalkTemplateLinks)
            .where(and(eq(alimtalkTemplateLinks.partitionId, p), eq(alimtalkTemplateLinks.triggerType, "on_create"), eq(alimtalkTemplateLinks.isActive, 1))).limit(1),
        db.select({ id: emailTemplateLinks.id }).from(emailTemplateLinks)
            .where(and(eq(emailTemplateLinks.partitionId, p), eq(emailTemplateLinks.triggerType, "on_create"), eq(emailTemplateLinks.isActive, 1))).limit(1),
        db.select({ id: emailAutoPersonalizedLinks.id }).from(emailAutoPersonalizedLinks)
            .where(and(eq(emailAutoPersonalizedLinks.partitionId, p), eq(emailAutoPersonalizedLinks.triggerType, "on_create"), eq(emailAutoPersonalizedLinks.isActive, 1))).limit(1),
        db.select({ id: recordAutoEnrichRules.id }).from(recordAutoEnrichRules)
            .where(and(eq(recordAutoEnrichRules.partitionId, p), eq(recordAutoEnrichRules.isActive, 1))).limit(1),
    ]);
    const hasAlim = alim.length > 0;
    const hasEmailAuto = emailAuto.length > 0;
    const hasAiEmail = aiEmail.length > 0;
    const hasEnrich = enrich.length > 0;

    // 알림톡은 레코드마다 동시에 시작하지 않고 5건씩 순차 처리한다(연결 1회 조회) — 응답은 기다리지 않는다(UX-254)
    if (hasAlim) processAutoTriggerBatch(insertedRecords, { partitionId: p, orgId: ctx.orgId }).catch((err) => console.error("[import] alimtalk batch error:", err));

    if (hasEmailAuto || hasEnrich) {
        for (const record of insertedRecords) {
            const triggerParams = { record, partitionId: p, triggerType: "on_create" as const, orgId: ctx.orgId };
            // 가져오기·예약 등록 명단의 템플릿 첫 메일은 대량이다 — 15:00(KST) 전까지 주소마다 문의 몫을 남긴다 (DESIGN-2 2절)
            if (hasEmailAuto) processEmailAutoTrigger({ ...triggerParams, purpose: "bulk" }).catch((err) => console.error("[import] email auto trigger error:", err));
            if (hasEnrich) processAutoEnrich(triggerParams).catch((err) => console.error("[import] auto enrich error:", err));
        }
    }

    if (hasAiEmail) {
        // 여기서 보내지 않는다 — 적재만 하고 워커가 발송한다.
        // 이 자리에서 직접 돌리면 응답 이후 프로세스 생명주기에 발송이 매달리고,
        // 한 건이라도 응답이 없으면(allSettled) 나머지 전량이 유실된다. (2026-09-01 사고)
        await enqueueSends({
            recordIds: insertedRecords.map((r) => r.id),
            partitionId: p,
            orgId: ctx.orgId,
            triggerType: "on_create",
        });

        // cron(10분)을 기다리지 않고 바로 시작시킨다. 실패해도 cron이 주워간다.
        wakeSendQueue();
    }
}
