import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { FunnelStage, StageMatch } from "@/components/tracker/types/funnel";
import { pagePathExpr } from "@/lib/tracker/page-path";

/**
 * 퍼널 분석 ─ 코호트 + sequential 방식.
 *
 * 코호트:
 *   기간 내 처음 방문한 visitor를 모수로 잡고, 이후(언제든) 단계 도달 여부를 본다.
 *   시점은 무시 — 그 단계에 한 번이라도 도달한 적 있는지만 본다.
 *
 * Sequential (누적 max-stage):
 *   각 visitor의 "최대 도달 단계 인덱스(maxIdx)"를 계산해서, 단계별 카운트는
 *   maxIdx >= i 인 visitor 수로 매긴다. → 위 단계 ≥ 아래 단계 보장 (133% 모순 제거).
 *   "전환까지 갔다가 종료된 사람"도 전환에 카운트 (산업 표준 — 도달 기준).
 *
 * 매칭 정의:
 *   - record_field: 현재 상태(records.data) 또는 record_events의 과거 도달 이력 합집합.
 *   - page_url:     tracker_events에 그 경로 PV가 있는가.
 */

interface StageContext {
    siteId: number;
    // 코호트 visitor 집합 (visit 단계). aggregateRange와 동일 조건.
    meaningfulVisitorIdsSql: ReturnType<typeof sql>;
}

// visitor가 거친 모든 record (대표 + N:M 링크 합집합)
function visitorRecordsAllCte() {
    return sql`
        WITH visitor_records_all AS (
            SELECT id AS visitor_id, record_id FROM tracker_visitors WHERE record_id IS NOT NULL
            UNION
            SELECT visitor_id, record_id FROM visitor_record_links
        )
    `;
}

/** 한 단계에 도달한 visitor id 집합을 반환. */
export async function getStageVisitorIds(
    ctx: StageContext,
    match: StageMatch,
): Promise<Set<number>> {
    if (match.type === "record_field") {
        // 생성·외부 갱신은 이력이 없을 수 있다. 현재 값과 과거 도달을 함께 본다.
        const rows = (await db.execute(sql`
            ${visitorRecordsAllCte()}
            SELECT DISTINCT vra.visitor_id AS id
            FROM visitor_records_all vra
            JOIN records r ON r.id = vra.record_id
            JOIN tracker_sites site ON site.id = ${ctx.siteId} AND site.org_id = r.org_id
            WHERE vra.visitor_id IN ${ctx.meaningfulVisitorIdsSql}
              AND (r.data->>${match.field} = ${match.value} OR EXISTS (
                SELECT 1 FROM record_events re WHERE re.record_id = vra.record_id
                  AND re.type = ${match.field} AND re.label = ${match.value}
              ))
        `)) as unknown as Array<{ id: number }>;
        return new Set(rows.map((r) => r.id));
    }

    if (match.type === "page_url") {
        const path = match.pathPrefix.replace(/\/+$/, "") || "/";
        const childPattern = path.replace(/[\\%_]/g, "\\$&") + "/%";
        const rows = (await db.execute(sql`
            SELECT DISTINCT ev.visitor_id AS id
            FROM tracker_events ev
            WHERE ev.site_id = ${ctx.siteId}
              AND ev.event_type = 'PAGE_VIEW'
              AND (${pagePathExpr("ev.page_url")} = ${path}
                OR (${path} <> '/' AND ${pagePathExpr("ev.page_url")} LIKE ${childPattern}))
              AND ev.visitor_id IN ${ctx.meaningfulVisitorIdsSql}
        `)) as unknown as Array<{ id: number }>;
        return new Set(rows.map((r) => r.id));
    }

    if (match.type === "custom_event") {
        // CUSTOM 이벤트(sendb.track) 발생 여부 — event_name 일치하면 도달.
        const rows = (await db.execute(sql`
            SELECT DISTINCT ev.visitor_id AS id
            FROM tracker_events ev
            WHERE ev.site_id = ${ctx.siteId}
              AND ev.event_type = 'CUSTOM'
              AND ev.event_name = ${match.eventName}
              AND ev.visitor_id IN ${ctx.meaningfulVisitorIdsSql}
        `)) as unknown as Array<{ id: number }>;
        return new Set(rows.map((r) => r.id));
    }

    return new Set();
}

/**
 * 사용자 정의 stages 배열을 받아, 각 단계별 도달 visitor 수를 sequential 방식으로 계산.
 *
 * @returns stages 인덱스별 visitor 수 (cumulative: i단계 visitors = maxIdx >= i 인 visitor 수)
 *
 * 동작:
 *   1. 각 stage 마다 도달 visitor 집합 조회
 *   2. visitor별 maxIdx = max(i where visitor ∈ stage[i] visitors)
 *   3. stage[i].visitors = (maxIdx >= i 인 visitor 수)
 *
 * leadVisitorIds는 자동 2단(리드)에 도달한 visitor — 사용자 정의 단계는 3단부터라
 * leadVisitorIds 보다 위 단계에 매칭된 visitor는 자동으로 리드도 통과한 것으로 본다.
 */
export async function computeSequentialStageCounts(
    ctx: StageContext,
    stages: FunnelStage[],
): Promise<number[]> {
    if (stages.length === 0) return [];

    // 각 stage 도달 visitor 집합
    const stageSets = await Promise.all(
        stages.map((s) => getStageVisitorIds(ctx, s.match)),
    );

    // visitor 단위 maxIdx 계산.
    // maxIdx = 사용자 정의 단계 중 가장 높은 인덱스 (없으면 -1).
    // 본 함수에선 자동 단계를 포함하지 않고 사용자 정의 단계만 다룬다.
    const maxIdxByVisitor = new Map<number, number>();
    for (let i = 0; i < stageSets.length; i++) {
        for (const v of stageSets[i]) {
            const prev = maxIdxByVisitor.get(v) ?? -1;
            if (i > prev) maxIdxByVisitor.set(v, i);
        }
    }

    // cumulative: stages[i].visitors = (maxIdx >= i 인 visitor 수)
    const counts = new Array<number>(stages.length).fill(0);
    for (const maxIdx of maxIdxByVisitor.values()) {
        for (let i = 0; i <= maxIdx; i++) counts[i] += 1;
    }
    return counts;
}

// 자동 단계 키
export const AUTO_STAGE_VISIT = "visit";
export const AUTO_STAGE_LEAD = "lead";

export function isAutoStageKey(key: string): boolean {
    return key === AUTO_STAGE_VISIT || key === AUTO_STAGE_LEAD;
}

// stages 배열 검증 — 자동 단계 키 충돌 방지
export function validateUserStages(stages: FunnelStage[]): string | null {
    for (const s of stages) {
        if (isAutoStageKey(s.key)) {
            return `자동 단계 키(${s.key})는 사용할 수 없습니다.`;
        }
    }
    const keys = stages.map((s) => s.key);
    if (new Set(keys).size !== keys.length) return "단계 key가 중복됩니다.";
    return null;
}
