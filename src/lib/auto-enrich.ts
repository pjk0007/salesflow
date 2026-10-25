import { db, recordAutoEnrichRules, records, partitions, fieldDefinitions } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getSearchAiClient, generateFieldEnrichment, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import { broadcastToPartition } from "@/lib/sse";
import type { DbRecord } from "@/lib/db";
import type { RecordDb as Executor } from "@/lib/record-create";

/** 레코드의 현재 data (삭제됐으면 null) — 규칙마다 최신 값으로 다시 판단한다 */
export async function loadRecordData(exec: Executor, recordId: number): Promise<Record<string, unknown> | null> {
    const [row] = await exec.select({ data: records.data }).from(records).where(eq(records.id, recordId)).limit(1);
    return row ? ((row.data ?? {}) as Record<string, unknown>) : null;
}

/**
 * 보강 결과를 DB 쪽에서 병합한다 — 지금 비어 있는 키에만 채우고, 그사이 사람·자동화가 쓴 값은 그대로 둔다 (UX-065).
 * 생성 시점 사본으로 data 전체를 덮어쓰지 않는다. 레코드가 남아 있어 갱신했으면 true.
 */
export async function mergeEnrichedFields(
    exec: Executor,
    recordId: number,
    filled: Record<string, unknown>
): Promise<boolean> {
    if (Object.keys(filled).length === 0) return false;
    const patch = sql`(SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(${JSON.stringify(filled)}::jsonb) e
        WHERE COALESCE(${records.data}->>e.key, '') = '')`;
    const [row] = await exec
        .update(records)
        .set({ data: sql`${records.data} || COALESCE(${patch}, '{}'::jsonb)`, updatedAt: new Date() })
        .where(eq(records.id, recordId))
        .returning({ id: records.id });
    return !!row;
}

interface AutoEnrichParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create";
    orgId: string;
}

export async function processAutoEnrich(params: AutoEnrichParams): Promise<void> {
    const { record, partitionId, orgId } = params;

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

    // AI 클라이언트 (필드 보강은 웹검색 필요 → SEARCH_MODEL_ID 고정)
    const aiClient = getSearchAiClient();
    if (!aiClient) {
        console.log("[AutoEnrich] ANTHROPIC_API_KEY missing");
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

    let changed = false;
    for (const rule of rules) {
        try {
            // 규칙마다 최신 행에서 시작한다 — 앞 규칙이 채운 값·그사이 사람이 바꾼 값을 기준으로 판단
            const data = await loadRecordData(db, record.id);
            if (!data) {
                console.log(`[AutoEnrich] Record ${record.id} deleted — stop`);
                break;
            }

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

            const merged = await mergeEnrichedFields(
                db,
                record.id,
                Object.fromEntries(filledFields.map((key) => [key, result.data[key]]))
            );
            changed ||= merged;

            console.log(`[AutoEnrich] Rule ${rule.id}: filled ${filledFields.length} fields`);

            // 7. AI 사용량 로깅
            const totalTokens = result.usage.promptTokens + result.usage.completionTokens;
            await updateTokenUsage(orgId, totalTokens);
            await logAiUsage({
                orgId,
                userId: null,
                provider: aiClient.provider,
                model: aiClient.model,
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                purpose: "auto_enrich",
            });
        } catch (err) {
            console.error(`[AutoEnrich] Rule ${rule.id} error:`, err);
        }
    }

    // 보강 결과가 새로고침 없이 목록에 보이도록
    if (changed) broadcastToPartition(partitionId, "record:updated", { partitionId, recordId: record.id });
}
