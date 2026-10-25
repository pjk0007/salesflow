import { and, eq, sql } from "drizzle-orm";
import { db, trackerSites, trackerVisitors, type TrackerVisitor } from "@/lib/db";
import { buildTrackerLabelMaps } from "@/lib/journey/tracker-label-maps";

/**
 * 방문자 상세(트래커) 조회 조각. 상세 API와 세션 이벤트 추가 조회 API가 같은 접근 확인·이벤트 열을 쓴다.
 */

/** 상세에서 펼쳐 보는 최근 세션 수 */
export const VISITOR_SESSION_LIMIT = 30;
/** 세션마다 처음 보내는 최신 이벤트 수. 더 오래된 행동은 세션 이벤트 API로 이어 받는다 */
export const SESSION_EVENT_LIMIT = 200;
export const SESSION_EVENT_PAGE_MAX = 500;

type Exec = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * 방문자 + (record로 식별됐으면) 같은 record의 모든 기기 방문자. 사이트가 요청 조직 것이 아니면 forbidden.
 */
export async function loadVisitorGroup(visitorPk: number, orgId: string): Promise<
    | { ok: true; visitor: TrackerVisitor; group: TrackerVisitor[] }
    | { ok: false; status: 403 | 404; error: string }
> {
    const visitor = await db.query.trackerVisitors.findFirst({ where: eq(trackerVisitors.id, visitorPk) });
    if (!visitor) return { ok: false, status: 404, error: "방문자를 찾을 수 없습니다." };
    const [site] = await db
        .select({ id: trackerSites.id })
        .from(trackerSites)
        .where(and(eq(trackerSites.id, visitor.siteId), eq(trackerSites.orgId, orgId)));
    if (!site) return { ok: false, status: 403, error: "권한이 없습니다." };
    const group = visitor.recordId
        ? await db
            .select()
            .from(trackerVisitors)
            .where(and(eq(trackerVisitors.siteId, visitor.siteId), eq(trackerVisitors.recordId, visitor.recordId)))
        : [visitor];
    return { ok: true, visitor, group };
}

const EVENT_COLUMNS = sql.raw(`id, site_id AS "siteId", session_id AS "sessionId", visitor_id AS "visitorId",
    event_type AS "eventType", event_name AS "eventName", page_url AS "pageUrl", page_title AS "pageTitle",
    properties, revenue, occurred_at AS "occurredAt"`);

export type SessionEventRow = {
    id: number; siteId: number; sessionId: number; visitorId: number;
    eventType: string; eventName: string | null; pageUrl: string | null; pageTitle: string | null;
    properties: Record<string, unknown> | null; revenue: string | null; occurredAt: Date | string;
};

const idList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * 세션마다 최신 이벤트 perSession개(동시각은 id로 보조 정렬)를 시간순으로 돌려준다.
 * 이전에는 세션 묶음 전체에서 오래된 이벤트부터 1000개를 잘라 최신 세션의 행동이 빠졌다(UX-207).
 * sessionTotals는 세션별 전체 이벤트 수 — 보낸 수보다 크면 화면이 이전 행동을 이어 받는다.
 */
export async function loadLatestSessionEvents(
    sessionIds: number[],
    perSession = SESSION_EVENT_LIMIT,
    exec: Exec = db,
): Promise<{ events: SessionEventRow[]; sessionTotals: Record<number, number> }> {
    if (sessionIds.length === 0) return { events: [], sessionTotals: {} };
    const rows = (await exec.execute(sql`
        SELECT ${EVENT_COLUMNS}, "sessionTotal"
        FROM (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY occurred_at DESC, id DESC) AS rn,
                   COUNT(*) OVER (PARTITION BY session_id)::int AS "sessionTotal"
            FROM tracker_events
            WHERE session_id IN (${idList(sessionIds)})
        ) ranked
        WHERE rn <= ${perSession}
        ORDER BY occurred_at, id
    `)) as Array<SessionEventRow & { sessionTotal: number }>;
    const sessionTotals: Record<number, number> = {};
    const events = rows.map(({ sessionTotal, ...event }) => {
        sessionTotals[event.sessionId] = Number(sessionTotal);
        return event;
    });
    return { events, sessionTotals };
}

/**
 * 한 세션에서 커서 이벤트(beforeId)보다 이전 이벤트를 limit개 시간순으로 돌려준다.
 * 커서 시각은 DB에서 다시 읽는다 — 화면의 밀리초 문자열로 비교하면 같은 밀리초 안의 이벤트를 건너뛴다.
 * 세션이 visitorIds(접근 확인된 방문자 묶음) 밖이면 빈 결과.
 */
export async function loadOlderSessionEvents(
    args: { sessionId: number; visitorIds: number[]; beforeId: number; limit: number },
    exec: Exec = db,
): Promise<{ events: SessionEventRow[]; hasMore: boolean }> {
    const { sessionId, visitorIds, beforeId, limit } = args;
    if (visitorIds.length === 0) return { events: [], hasMore: false };
    const rows = (await exec.execute(sql`
        SELECT ${EVENT_COLUMNS}
        FROM tracker_events ev
        WHERE ev.session_id = ${sessionId}
          AND ev.visitor_id IN (${idList(visitorIds)})
          AND (ev.occurred_at, ev.id) < (
              SELECT c.occurred_at, c.id FROM tracker_events c WHERE c.id = ${beforeId} AND c.session_id = ${sessionId}
          )
        ORDER BY ev.occurred_at DESC, ev.id DESC
        LIMIT ${limit + 1}
    `)) as SessionEventRow[];
    return { events: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
}

/** 방문자 묶음 전체 세션의 체류시간 합(초). 상세 카드의 방문수·페이지뷰와 같은 전체 범위다(UX-208). */
export async function loadTotalDuration(visitorIds: number[], exec: Exec = db): Promise<number> {
    if (visitorIds.length === 0) return 0;
    const [row] = (await exec.execute(sql`
        SELECT COALESCE(SUM(duration), 0)::bigint AS total FROM tracker_sessions WHERE visitor_id IN (${idList(visitorIds)})
    `)) as Array<{ total: string | number }>;
    return Number(row?.total ?? 0);
}

/**
 * 섹션·클릭 집계에 별칭 라벨을 붙인다. 빈·공백 라벨은 없는 것으로 보고(null) 화면이 원래 이벤트 이름을 쓴다(UX-209).
 * 라벨 규칙은 여정·알림과 같은 buildTrackerLabelMaps를 쓴다.
 */
export function labelVisitorEngagement<
    S extends { name: string | null },
    C extends { name: string | null },
>(
    sectionRows: S[],
    clickRows: C[],
    aliasRows: ReadonlyArray<{ eventType: string; eventName: string; label: string | null }>,
) {
    const labels = buildTrackerLabelMaps([], aliasRows).eventLabels;
    return {
        sections: sectionRows
            .filter((r): r is S & { name: string } => Boolean(r.name))
            .map((r) => ({ ...r, label: labels.get(`SECTION_VIEW:${r.name}`) ?? null })),
        clicks: clickRows
            .filter((r): r is C & { name: string } => Boolean(r.name))
            .map((r) => ({ ...r, label: labels.get(`CLICK:${r.name}`) ?? null })),
        /** 타임라인용 "TYPE:name" → 라벨 (빈 라벨 제외) */
        aliases: Object.fromEntries(labels) as Record<string, string>,
    };
}
