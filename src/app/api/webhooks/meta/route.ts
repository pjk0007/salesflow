import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adLeadIntegrations, adLeadLogs, adAccounts, adPlatforms, partitions, workspaces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { MetaCredentials } from "@/types";
import { createRecord, toRecordCreatePartition } from "@/lib/record-create";

// GET: Meta Webhook 검증
export async function GET(req: NextRequest) {
    const mode = req.nextUrl.searchParams.get("hub.mode");
    const token = req.nextUrl.searchParams.get("hub.verify_token");
    const challenge = req.nextUrl.searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // DB에서 해당 verify token을 가진 플랫폼이 있는지 확인
    const allMetaPlatforms = await db
        .select({ credentials: adPlatforms.credentials })
        .from(adPlatforms)
        .where(and(eq(adPlatforms.platform, "meta"), eq(adPlatforms.status, "connected")));

    const matched = allMetaPlatforms.some((p) => {
        const creds = p.credentials as MetaCredentials;
        return creds.webhookVerifyToken === token;
    });

    if (matched) {
        return new Response(challenge || "", { status: 200 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST: Meta 리드 이벤트 수신
export async function POST(req: NextRequest) {
    const body = await req.json();

    // 즉시 200 응답 (Meta 타임아웃 방지)
    // 비동기로 리드 처리
    processMetaWebhook(body).catch((err) => {
        console.error("[Meta Webhook] processing error:", err);
    });

    return NextResponse.json({ success: true });
}

interface MetaWebhookBody {
    object: string;
    entry: Array<{
        id: string;
        time: number;
        changes: Array<{
            field: string;
            value: {
                leadgen_id: string;
                form_id: string;
                ad_id: string;
                page_id: string;
                created_time: number;
            };
        }>;
    }>;
}

async function processMetaWebhook(body: MetaWebhookBody) {
    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== "leadgen") continue;

            const { leadgen_id, form_id, ad_id } = change.value;

            try {
                await processLead(leadgen_id, form_id, ad_id);
            } catch (err) {
                console.error(`[Meta Webhook] lead ${leadgen_id} processing failed:`, err);
            }
        }
    }
}

async function processLead(leadgenId: string, formId: string, adId?: string) {
    // 1. 연동 설정 찾기
    const [integration] = await db
        .select()
        .from(adLeadIntegrations)
        .where(
            and(
                eq(adLeadIntegrations.formId, formId),
                eq(adLeadIntegrations.platform, "meta"),
                eq(adLeadIntegrations.isActive, 1)
            )
        )
        .limit(1);

    if (!integration) {
        // 매칭 안됨 — 다른 앱의 이벤트일 수 있음
        return;
    }

    // 2. 중복 체크
    const [existing] = await db
        .select()
        .from(adLeadLogs)
        .where(eq(adLeadLogs.externalLeadId, leadgenId))
        .limit(1);

    if (existing) {
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            status: "duplicate",
        });
        return;
    }

    // 3. 액세스 토큰 조회
    const [accountRow] = await db
        .select({
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
            await db.insert(adLeadLogs).values({
                integrationId: integration.id,
                externalLeadId: leadgenId,
                rawData: data,
                status: "failed",
                errorMessage: `Meta API 오류: ${data.error.message}`,
            });
            return;
        }

        // 리드 필드 데이터 추출
        leadData = {};
        for (const field of data.field_data || []) {
            leadData[field.name] = Array.isArray(field.values) ? field.values[0] : field.values;
        }
    } catch (err) {
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            status: "failed",
            errorMessage: `Meta API 요청 실패: ${err instanceof Error ? err.message : "Unknown"}`,
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
        const created = await createRecord({
            orgId: integration.orgId,
            partition: toRecordCreatePartition(partitionRow.partition),
            data: recordData,
            sourceDefaults,
            source: "meta_ad",
        });

        if (created.status === "duplicate") {
            await db.insert(adLeadLogs).values({
                integrationId: integration.id,
                externalLeadId: leadgenId,
                recordId: created.existingRecordId,
                rawData: leadData,
                status: "duplicate",
                errorMessage: `파티션 중복 설정(거부)으로 등록하지 않았습니다. (${created.fieldLabel}: ${created.value})`,
            });
            return;
        }
        if (created.status === "plan_limit") {
            throw new Error("Meta 리드는 레코드 한도를 강제하지 않는다 — plan_limit가 올 수 없음");
        }

        // 9. 성공 로그 (병합이면 합친 기존 레코드를 가리킨다)
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            recordId: created.record.id,
            rawData: leadData,
            status: "success",
            errorMessage: created.status === "merged" ? "파티션 중복 설정(병합)으로 기존 레코드에 합쳤습니다." : null,
        });
    } catch (err) {
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            rawData: leadData,
            status: "failed",
            errorMessage: `레코드 생성 실패: ${err instanceof Error ? err.message : "Unknown"}`,
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
