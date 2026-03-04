import { db, recordAutoEnrichRules, records, partitions, fieldDefinitions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getAiClient, generateFieldEnrichment, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import type { DbRecord } from "@/lib/db";

interface AutoEnrichParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create";
    orgId: string;
}

export async function processAutoEnrich(params: AutoEnrichParams): Promise<void> {
    const { record, partitionId, orgId } = params;
    const data = (record.data ?? {}) as Record<string, unknown>;

    console.log(`[AutoEnrich] Start: record=${record.id}, partition=${partitionId}`);

    // 1. 매칭 규칙 조회
    const rules = await db
        .select()
        .from(recordAutoEnrichRules)
        .where(
            and(
                eq(recordAutoEnrichRules.partitionId, partitionId),
                eq(recordAutoEnrichRules.isActive, 1)
            )
        );

    if (rules.length === 0) {
        console.log("[AutoEnrich] No active rules");
        return;
    }

    // AI 클라이언트
    const aiClient = getAiClient();
    if (!aiClient) {
        console.log("[AutoEnrich] GEMINI_API_KEY missing");
        return;
    }

    // 파티션 → 워크스페이스 → 필드 정의 조회
    const [partition] = await db
        .select({ workspaceId: partitions.workspaceId })
        .from(partitions)
        .where(eq(partitions.id, partitionId))
        .limit(1);
    if (!partition) return;

    const allFields = await db
        .select({ key: fieldDefinitions.key, label: fieldDefinitions.label })
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.workspaceId, partition.workspaceId));

    const fieldMap = new Map(allFields.map((f) => [f.key, f.label]));

    for (const rule of rules) {
        try {
            // 2. 검색어 추출
            const searchValue = data[rule.searchField];
            if (!searchValue || typeof searchValue !== "string" || !searchValue.trim()) {
                console.log(`[AutoEnrich] Rule ${rule.id}: searchField "${rule.searchField}" empty`);
                continue;
            }

            // 3. 비어있는 대상 필드만 필터
            const targetFields = (rule.targetFields ?? []) as string[];
            const emptyFields = targetFields.filter((key) => {
                const val = data[key];
                return val === undefined || val === null || val === "";
            });

            if (emptyFields.length === 0) {
                console.log(`[AutoEnrich] Rule ${rule.id}: all target fields already filled`);
                continue;
            }

            // 4. 쿼터 체크
            const quota = await checkTokenQuota(orgId);
            if (!quota.allowed) {
                console.log(`[AutoEnrich] Rule ${rule.id}: quota exceeded`);
                continue;
            }

            // 5. AI 웹검색으로 필드 보강
            const fieldsToEnrich = emptyFields.map((key) => ({
                key,
                label: fieldMap.get(key) || key,
            }));

            console.log(`[AutoEnrich] Rule ${rule.id}: searching "${searchValue}" for ${emptyFields.length} fields`);

            const result = await generateFieldEnrichment(aiClient, {
                searchValue: searchValue.trim(),
                fields: fieldsToEnrich,
                additionalContext: data,
            });

            // 6. 비어있는 필드만 record.data에 병합
            const filledFields = Object.keys(result.data).filter((k) => result.data[k]);
            if (filledFields.length === 0) {
                console.log(`[AutoEnrich] Rule ${rule.id}: no data found from search`);
                continue;
            }

            const updatedData = { ...data };
            for (const key of filledFields) {
                if (!updatedData[key] || updatedData[key] === "") {
                    updatedData[key] = result.data[key];
                }
            }

            await db
                .update(records)
                .set({ data: updatedData, updatedAt: new Date() })
                .where(eq(records.id, record.id));

            console.log(`[AutoEnrich] Rule ${rule.id}: filled ${filledFields.length} fields`);

            // 7. AI 사용량 로깅
            const totalTokens = result.usage.promptTokens + result.usage.completionTokens;
            await updateTokenUsage(orgId, totalTokens);
            await logAiUsage({
                orgId,
                userId: null,
                provider: "gemini",
                model: aiClient.model,
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                purpose: "auto_enrich",
            });
        } catch (err) {
            console.error(`[AutoEnrich] Rule ${rule.id} error:`, err);
        }
    }
}
