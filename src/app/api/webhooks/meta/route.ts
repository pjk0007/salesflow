import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adLeadIntegrations, adLeadLogs, adAccounts, adPlatforms, records, partitions, workspaces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { MetaCredentials } from "@/types";
import { applyFieldDefaults } from "@/lib/apply-field-defaults";

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

    // 기본값 적용
    for (const [column, value] of Object.entries(defaultValues)) {
        if (value !== null && value !== undefined) {
            recordData[column] = typeof value === "boolean" ? (value ? 1 : 0) : value;
        }
    }

    // 광고 소재/캠페인 이름 자동 추가
    if (adName) recordData.adName = adName;
    if (campaignName) recordData.campaignName = campaignName;

    // 등록일 자동 설정
    if (!recordData.registeredAt) {
        recordData.registeredAt = new Date().toISOString();
    }

    // 7. 파티션의 워크스페이스 정보 조회
    const [partitionRow] = await db
        .select({
            workspaceId: partitions.workspaceId,
            orgId: workspaces.orgId,
        })
        .from(partitions)
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(eq(partitions.id, integration.partitionId));

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

    // 8. 필드 기본값 적용
    const finalRecordData = await applyFieldDefaults(integration.partitionId!, recordData);

    // 9. 레코드 생성
    try {
        const [newRecord] = await db
            .insert(records)
            .values({
                orgId: integration.orgId,
                workspaceId: partitionRow.workspaceId,
                partitionId: integration.partitionId,
                data: finalRecordData,
                registeredAt: new Date(),
            })
            .returning({ id: records.id });

        // 9. 성공 로그
        await db.insert(adLeadLogs).values({
            integrationId: integration.id,
            externalLeadId: leadgenId,
            recordId: newRecord.id,
            rawData: leadData,
            status: "success",
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
