import {
    db,
    records,
    organizations,
    alimtalkTemplateLinks,
    emailTemplateLinks,
    emailAutoPersonalizedLinks,
    recordAutoEnrichRules,
    type DbRecord,
} from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { processAutoTrigger } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { processAutoPersonalizedEmail } from "@/lib/auto-personalized-email";
import { processAutoEnrich } from "@/lib/auto-enrich";

// db 트랜잭션 / db 둘 다 받을 수 있는 최소 실행기 타입
type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

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
}

export interface InsertImportedRecordsResult {
    totalCount: number;
    insertedCount: number;
    skippedCount: number;
    mergedCount: number;
    errors: Array<{ row: number; message: string }>;
    insertedRecords: DbRecord[];
}

/**
 * 가져오기/예약등록 공용 — 데이터 행들을 레코드로 생성한다.
 * 통합코드 채번 + 파티션 중복 정책(reject/allow/merge/delete_old) 처리 + insert.
 * 반드시 트랜잭션(tx) 안에서 호출할 것. 트리거는 호출하지 않는다(=dispatchImportTriggers 별도).
 */
export async function insertImportedRecords(
    tx: DbExecutor,
    { orgId, partition, dataRows, duplicateAction = "skip", onProgress }: InsertImportedRecordsParams,
): Promise<InsertImportedRecordsResult> {
    const partitionId = partition.id;

    // 조직 정보 (통합코드용)
    const [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId));

    // 중복 체크 필드 (duplicateConfig 우선, fallback to duplicateCheckField)
    const dupConfig = partition.duplicateConfig;
    const duplicateField = dupConfig?.field || partition.duplicateCheckField;
    const dupAction = dupConfig?.action || "reject"; // reject=skip/error, allow/merge/delete_old

    // 기존 레코드 값 → ID 매핑 (merge/delete_old용)
    const existingMap = new Map<string, number>();
    const existingDataMap = new Map<string, Record<string, unknown>>();
    if (duplicateField) {
        const existing = await tx
            .select({ id: records.id, data: records.data, val: sql<string>`${records.data}->>${duplicateField}` })
            .from(records)
            .where(eq(records.partitionId, partitionId));
        for (const r of existing) {
            if (r.val) {
                existingMap.set(r.val, r.id);
                existingDataMap.set(r.val, r.data as Record<string, unknown>);
            }
        }
    }

    const batchValues = new Set<string>();
    const errors: Array<{ row: number; message: string }> = [];
    const insertedRecords: DbRecord[] = [];
    let insertedCount = 0;
    let skippedCount = 0;
    let mergedCount = 0;
    let currentSeq = org.integratedCodeSeq;

    for (let i = 0; i < dataRows.length; i++) {
        if (onProgress && i % 50 === 0) onProgress(i, dataRows.length);
        const data = dataRows[i];

        // 중복 체크
        if (duplicateField && data[duplicateField]) {
            const val = String(data[duplicateField]);
            const isDupExisting = existingMap.has(val);
            const isDupBatch = batchValues.has(val);

            if (isDupExisting || isDupBatch) {
                if (dupAction === "allow") {
                    // 그대로 진행 (중복 허용)
                } else if (dupAction === "merge" && isDupExisting) {
                    const existingData = existingDataMap.get(val) || {};
                    const mergedData = { ...existingData, ...data };
                    await tx
                        .update(records)
                        .set({ data: mergedData, updatedAt: new Date() })
                        .where(eq(records.id, existingMap.get(val)!));
                    existingDataMap.set(val, mergedData);
                    mergedCount++;
                    continue;
                } else if (dupAction === "delete_old" && isDupExisting) {
                    await tx.delete(records).where(eq(records.id, existingMap.get(val)!));
                    existingMap.delete(val);
                    existingDataMap.delete(val);
                } else {
                    // reject
                    if (duplicateAction === "skip") {
                        skippedCount++;
                        continue;
                    } else {
                        errors.push({ row: i + 1, message: `중복: ${duplicateField}="${val}"` });
                        continue;
                    }
                }
            }
            batchValues.add(val);
        }

        // 통합코드 생성
        currentSeq++;
        const integratedCode = `${org.integratedCodePrefix}-${String(currentSeq).padStart(4, "0")}`;

        const [inserted] = await tx.insert(records).values({
            orgId,
            workspaceId: partition.workspaceId,
            partitionId,
            integratedCode,
            data,
        }).returning();
        insertedCount++;
        insertedRecords.push(inserted);
    }

    if (onProgress) onProgress(dataRows.length, dataRows.length);

    // 조직 시퀀스 업데이트
    await tx
        .update(organizations)
        .set({ integratedCodeSeq: currentSeq })
        .where(eq(organizations.id, org.id));

    return { totalCount: dataRows.length, insertedCount, skippedCount, mergedCount, errors, insertedRecords };
}

/**
 * 가져오기/예약등록 공용 — 생성된 레코드들에 대해 자동 트리거를 발동한다.
 *
 * 핵심: 파티션에 활성 규칙이 있는지 **1회만** 확인하고, 규칙이 있는 트리거만 레코드별로 돈다.
 * (규칙이 없으면 레코드마다 조회·로그가 폭주하던 문제 방지 — 대량 가져오기 시 수천 줄 로그/쿼리 제거.)
 *
 * 알림톡/이메일/보강은 fire-and-forget, AI 개인화 메일은 5건/배치·1초 딜레이로 rate limit 준수.
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

    if (hasAlim || hasEmailAuto || hasEnrich) {
        for (const record of insertedRecords) {
            const triggerParams = { record, partitionId: p, triggerType: "on_create" as const, orgId: ctx.orgId };
            if (hasAlim) processAutoTrigger(triggerParams).catch((err) => console.error("[import] auto trigger error:", err));
            if (hasEmailAuto) processEmailAutoTrigger(triggerParams).catch((err) => console.error("[import] email auto trigger error:", err));
            if (hasEnrich) processAutoEnrich(triggerParams).catch((err) => console.error("[import] auto enrich error:", err));
        }
    }

    if (hasAiEmail) {
        const BATCH_SIZE = 5;
        const BATCH_DELAY_MS = 1000;
        for (let i = 0; i < insertedRecords.length; i += BATCH_SIZE) {
            const batch = insertedRecords.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
                batch.map((record) =>
                    processAutoPersonalizedEmail({ record, partitionId: p, triggerType: "on_create", orgId: ctx.orgId }),
                ),
            );
            if (i + BATCH_SIZE < insertedRecords.length) {
                await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
            }
        }
    }
}
