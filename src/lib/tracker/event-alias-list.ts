import { sql } from "drizzle-orm";
import type { EventAliasType } from "@/components/tracker/types/event-alias";

/**
 * 이벤트 라벨 목록(설정 카드) — 발생 이벤트와 등록 별칭의 합집합을 서버에서 걸러 페이지로 나눈다.
 * 타입·검색은 LIMIT 전에 적용하고, 정렬은 타입 → 발생수 내림차순 → 이름으로 고정한다(같은 타입 안에서 이름은 유일).
 */

export const EVENT_ALIAS_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const TYPES: readonly EventAliasType[] = ["SECTION_VIEW", "CLICK", "CUSTOM"];

export interface EventAliasListQuery {
    type: EventAliasType | null;
    q: string;
    page: number;
    pageSize: number;
}

function positiveInt(raw: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
    const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

export function parseEventAliasListQuery(sp: URLSearchParams): EventAliasListQuery {
    const type = sp.get("type");
    return {
        type: TYPES.includes(type as EventAliasType) ? (type as EventAliasType) : null,
        q: (sp.get("q") ?? "").trim().slice(0, 100),
        page: positiveInt(sp.get("page"), 1),
        pageSize: positiveInt(sp.get("pageSize"), EVENT_ALIAS_PAGE_SIZE, MAX_PAGE_SIZE),
    };
}

/** 필터를 적용한 행 집합(정렬·페이지 전). 열: id, eventType, eventName, label, occurrences */
function filteredRowsSql(siteId: number, query: Pick<EventAliasListQuery, "type" | "q">) {
    const typeFilter = query.type ? sql`AND k.event_type = ${query.type}` : sql``;
    // LIKE 와일드카드(%·_)가 검색어에 섞여도 글자 그대로 찾도록 position으로 비교한다
    const search = query.q
        ? sql`AND (position(lower(${query.q}) in lower(k.event_name)) > 0
                   OR position(lower(${query.q}) in lower(COALESCE(a.label, ''))) > 0)`
        : sql``;
    return sql`
        WITH occ AS (
            SELECT event_type, event_name, COUNT(*)::int AS occurrences
            FROM tracker_events
            WHERE site_id = ${siteId}
              AND event_type IN ('SECTION_VIEW', 'CLICK', 'CUSTOM')
              AND event_name IS NOT NULL
            GROUP BY event_type, event_name
        ),
        keys AS (
            SELECT event_type, event_name FROM occ
            UNION
            SELECT event_type, event_name FROM tracker_event_aliases WHERE site_id = ${siteId}
        ),
        filtered AS (
            SELECT
                a.id,
                k.event_type AS "eventType",
                k.event_name AS "eventName",
                a.label,
                COALESCE(o.occurrences, 0)::int AS occurrences
            FROM keys k
            LEFT JOIN occ o ON o.event_type = k.event_type AND o.event_name = k.event_name
            LEFT JOIN tracker_event_aliases a
                ON a.site_id = ${siteId} AND a.event_type = k.event_type AND a.event_name = k.event_name
            WHERE TRUE ${typeFilter} ${search}
        )`;
}

export function eventAliasCountSql(siteId: number, query: Pick<EventAliasListQuery, "type" | "q">) {
    return sql`${filteredRowsSql(siteId, query)} SELECT COUNT(*)::int AS total FROM filtered`;
}

export function eventAliasPageSql(siteId: number, query: EventAliasListQuery) {
    return sql`${filteredRowsSql(siteId, query)}
        SELECT * FROM filtered
        ORDER BY "eventType", occurrences DESC, "eventName"
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
}

/** 요청 page가 마지막을 넘으면 마지막 유효 페이지로 당긴다(0건이면 1). */
export function clampEventAliasPage(query: EventAliasListQuery, total: number): EventAliasListQuery {
    const totalPages = Math.ceil(total / query.pageSize);
    return { ...query, page: Math.min(query.page, Math.max(1, totalPages)) };
}
