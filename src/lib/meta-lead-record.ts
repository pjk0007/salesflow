import { db, adLeadLogs } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createRecord, type CreateRecordInput, type RecordCreateDeps, type RecordDb } from "@/lib/record-create";

class LeadAlreadyProcessed extends Error {}

export async function hasProcessedMetaLead(exec: RecordDb, integrationId: number, leadgenId: string) {
    const [row] = await exec.select({ id: adLeadLogs.id }).from(adLeadLogs).where(and(
        eq(adLeadLogs.integrationId, integrationId),
        eq(adLeadLogs.externalLeadId, leadgenId),
        inArray(adLeadLogs.status, ["success", "duplicate"]),
    )).limit(1);
    return !!row;
}

/** 같은 리드의 재전송은 생성·성공 로그를 한 번만 커밋한다. 실패 이력은 재처리를 막지 않는다. */
export async function createMetaLeadRecord(
    input: Omit<CreateRecordInput, "source" | "beforeCreate" | "inTransaction">,
    lead: { integrationId: number; leadgenId: string; rawData: Record<string, string> },
    overrides: Partial<RecordCreateDeps> = {},
) {
    const exec = overrides.db ?? db;
    try {
        const result = await createRecord({
            ...input,
            source: "meta_ad",
            beforeCreate: async (tx) => {
                // 이벤트별 직렬화. 파티션의 일반 중복 설정이 '허용'이어도 웹훅 재전송은 한 번만 반영한다.
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('meta-lead'), hashtext(${`${lead.integrationId}:${lead.leadgenId}`}))`);
                if (await hasProcessedMetaLead(tx, lead.integrationId, lead.leadgenId)) throw new LeadAlreadyProcessed();
            },
            inTransaction: async (tx, record, kind) => {
                await tx.insert(adLeadLogs).values({
                    integrationId: lead.integrationId,
                    externalLeadId: lead.leadgenId,
                    recordId: record.id,
                    rawData: lead.rawData,
                    status: "success",
                    errorMessage: kind === "merged" ? "파티션 중복 설정(병합)으로 기존 레코드에 합쳤습니다." : null,
                });
                return null;
            },
        }, overrides);
        if (result.status === "duplicate") {
            await exec.insert(adLeadLogs).values({
                integrationId: lead.integrationId,
                externalLeadId: lead.leadgenId,
                recordId: result.existingRecordId,
                rawData: lead.rawData,
                status: "duplicate",
                errorMessage: `파티션 중복 설정(거부)으로 등록하지 않았습니다. (${result.fieldLabel}: ${result.value})`,
            });
        }
        return result;
    } catch (error) {
        if (error instanceof LeadAlreadyProcessed) return null;
        throw error;
    }
}
