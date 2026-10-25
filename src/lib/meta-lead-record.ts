import { db, adLeadLogs } from "@/lib/db";
import { adLeadIntegrations, adAccounts, adPlatforms, partitions, workspaces } from "@/lib/db/schema";
import type { MetaCredentials } from "@/types";
import { isMetaTokenError, markMetaPlatformExpired, metaErrorMessage } from "@/lib/meta-graph";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createRecord, toRecordCreatePartition, type CreateRecordInput, type RecordCreateDeps, type RecordDb } from "@/lib/record-create";

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

/**
 * Meta 리드 한 건 처리 — 웹훅 수신과 화면의 실패 리드 재처리(UX-049)가 같은 함수를 쓴다.
 * 이미 성공·중복 처리된 리드는 건너뛰므로 여러 번 불러도 레코드는 한 번만 생긴다.
 */
export async function processMetaLead(leadgenId: string, formId: string, adId?: string, integrationId?: number) {
    // 1. 연동 설정 찾기 (재처리는 실패 로그의 연동으로 고정한다)
    const [integration] = await db
        .select()
        .from(adLeadIntegrations)
        .where(
            and(
                eq(adLeadIntegrations.formId, formId),
                eq(adLeadIntegrations.platform, "meta"),
                eq(adLeadIntegrations.isActive, 1),
                integrationId !== undefined ? eq(adLeadIntegrations.id, integrationId) : undefined
            )
        )
        .limit(1);

    if (!integration) {
        // 매칭 안됨 — 다른 앱의 이벤트일 수 있음
        return;
    }

    // 이미 성공한 이벤트만 생략한다. 실패·미설정 이력은 복구 후 재처리할 수 있다.
    if (await hasProcessedMetaLead(db, integration.id, leadgenId)) return;

    // 3. 액세스 토큰 조회
    const [accountRow] = await db
        .select({
            platformId: adPlatforms.id,
            credentials: adPlatforms.credentials,
        })
        .from(adAccounts)
        .innerJoin(adPlatforms, eq(adPlatforms.id, adAccounts.adPlatformId))
        .where(eq(adAccounts.id, integration.adAccountId));

    if (!accountRow) {
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            status: "failed",
            errorMessage: "광고 계정 또는 플랫폼을 찾을 수 없습니다.",
        });
        return;
    }

    const credentials = accountRow.credentials as MetaCredentials;
    const { accessToken } = credentials;

    // 4. Meta API로 리드 상세 조회
    let leadData: Record<string, string>;
    try {
        const res = await fetch(
            `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${accessToken}`
        );
        const data = await res.json();

        if (data.error) {
            // 토큰 만료·취소면 화면이 계속 '연결됨'으로 보이지 않게 '만료됨'으로 바꾼다 (UX-049). 원문 오류는 rawData에 남긴다
            if (isMetaTokenError(data.error)) {
                await markMetaPlatformExpired(accountRow.platformId).catch((err) => console.error("[Meta Webhook] 만료 표시 실패:", err));
            }
            await db.insert(adLeadLogs).values({
                integrationId: integration.id,
                externalLeadId: leadgenId,
                rawData: data,
                status: "failed",
                errorMessage: metaErrorMessage(data.error),
            });
            return;
        }

        // 리드 필드 데이터 추출
        leadData = {};
        for (const field of data.field_data || []) {
            leadData[field.name] = Array.isArray(field.values) ? field.values[0] : field.values;
        }
    } catch (err) {
        console.error(`[Meta Webhook] lead ${leadgenId} 조회 요청 실패:`, err);
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            status: "failed",
            errorMessage: "Meta 서버에서 리드를 읽지 못했습니다. 잠시 뒤 '다시 처리'를 눌러주세요.",
        });
        return;
    }

    // 4-2. 광고 소재 이름 조회 (ad_id가 있는 경우)
    let adName: string | null = null;
    let campaignName: string | null = null;
    if (adId) {
        try {
            const adRes = await fetch(
                `https://graph.facebook.com/v21.0/${adId}?access_token=${accessToken}&fields=name,campaign{name}`
            );
            const adData = await adRes.json();
            if (!adData.error) {
                adName = adData.name || null;
                campaignName = adData.campaign?.name || null;
            }
        } catch {
            // 광고 조회 실패해도 리드 처리는 계속
        }
    }

    // 5. 파티션 유효성 검증
    if (!integration.partitionId) {
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            rawData: leadData,
            status: "skipped",
            errorMessage: "대상 파티션이 설정되지 않았습니다.",
        });
        return;
    }

    // 6. 필드 매핑 적용
    const fieldMappings = integration.fieldMappings as Record<string, string>;
    const defaultValues = (integration.defaultValues || {}) as Record<string, unknown>;
    const recordData: Record<string, unknown> = {};

    for (const [metaField, dbColumn] of Object.entries(fieldMappings)) {
        const value = leadData[metaField];
        if (value !== undefined && dbColumn) {
            recordData[dbColumn] = metaField.includes("phone") ? normalizeKoreanPhone(value) : value;
        }
    }

    // 연동 기본값 — 리드가 실제로 답한 값은 덮지 않고 빈 칸에만 채운다 (웹 폼과 같은 규칙, UX-038)
    const sourceDefaults: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(defaultValues)) {
        if (value !== null && value !== undefined) {
            sourceDefaults[column] = typeof value === "boolean" ? (value ? 1 : 0) : value;
        }
    }

    // 광고 소재/캠페인 이름 자동 추가
    if (adName) recordData.adName = adName;
    if (campaignName) recordData.campaignName = campaignName;

    // 등록일은 records.registered_at(시스템 컬럼)이 단일 진실원천 — data에 별도 저장하지 않음

    // 7. 파티션 조회 — 연동 조직의 파티션일 때만 받는다
    const [partitionRow] = await db
        .select({ partition: partitions })
        .from(partitions)
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(and(eq(partitions.id, integration.partitionId), eq(workspaces.orgId, integration.orgId)));

    if (!partitionRow) {
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            rawData: leadData,
            status: "skipped",
            errorMessage: "대상 파티션을 찾을 수 없습니다.",
        });
        return;
    }

    // 8. 생성 공통 경로 — 중복 정책·통합코드 발번·분배·기본값·자동화·자동 보강·실시간 갱신이 다른 유입 경로와 같다
    try {
        await createMetaLeadRecord({
            orgId: integration.orgId,
            partition: toRecordCreatePartition(partitionRow.partition),
            data: recordData,
            sourceDefaults,
        }, { integrationId: integration.id, leadgenId, rawData: leadData });
    } catch (err) {
        console.error(`[Meta Webhook] lead ${leadgenId} 레코드 생성 실패:`, err);
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            rawData: leadData,
            status: "failed",
            errorMessage: "레코드를 만들지 못했습니다. 잠시 뒤 '다시 처리'를 눌러주세요.",
        });
    }
}

function normalizeKoreanPhone(phone: string): string {
    if (!phone) return phone;
    let normalized = phone.replace(/^\+82\s?/, "0");
    if (/^0\d{9,10}$/.test(normalized)) {
        if (normalized.length === 11) {
            normalized = normalized.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
        } else if (normalized.length === 10) {
            normalized = normalized.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
        }
    }
    return normalized;
}
