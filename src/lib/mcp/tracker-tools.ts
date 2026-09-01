import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, trackerEvents, trackerFunnels, records } from "@/lib/db";
import { checkTokenAccess } from "@/lib/auth";
import { listAccessibleTrackerSites, resolveTrackerSiteForToken } from "@/lib/tracker/site-access";
import { computeFunnelStages, selectFunnel } from "@/lib/tracker/funnel-context";
import { aggregateRange, pct, queryPageAnalytics } from "@/lib/tracker/analytics-queries";
import { getSessionIdsByChannel } from "@/lib/tracker/session-filter";
import { buildRecordJourney } from "@/lib/tracker/journey";
import { isValidYmd, previousRange, rangeBounds, resolveRange } from "@/lib/tracker/date-range";
import { clampPageSize, computeFunnelMetrics } from "./tracker-format";
import { ok, err, type ToolHandler } from "./types";

/**
 * 트래커 MCP 툴. 전부 조회 전용이다.
 *
 * 권한은 두 겹이다:
 *   ① org 경계 — resolveTrackerSiteForToken이 orgId로 먼저 거른다
 *   ② 스코프   — 토큰 스코프를 워크스페이스로 해석해 판정
 * get_record_journey만 축이 달라 checkTokenAccess(partitionId)를 쓴다 —
 * 레코드는 파티션에 속하고 그 축이 이미 정확하기 때문이다.
 *
 * 사이트·퍼널이 추가돼도 코드를 고칠 필요가 없다. 목록 조회형이라
 * 이름·개수가 코드에 하드코딩돼 있지 않다.
 */

const DEVICES = ["desktop", "mobile", "tablet"] as const;

function num(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

function str(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** from/to를 검증해 정규화한다. MCP는 Claude가 "지난달" 같은 문자열을 넣을 수 있다. */
function parseRange(args: Record<string, unknown>): { fromYmd: string; toYmd: string } | string {
    const from = str(args.from);
    const to = str(args.to);
    if (from && !isValidYmd(from)) return "from은 YYYY-MM-DD 형식이어야 합니다.";
    if (to && !isValidYmd(to)) return "to는 YYYY-MM-DD 형식이어야 합니다.";
    const range = resolveRange(from ?? null, to ?? null);
    // 역전 범위를 두면 집계가 조용히 0건으로 나오고 previousRange가 미래 구간을 만든다
    if (range.fromYmd > range.toYmd) return "from이 to보다 늦을 수 없습니다.";
    return range;
}

function parseDevice(value: unknown): string | null {
    const d = str(value);
    return d && (DEVICES as readonly string[]).includes(d) ? d : null;
}

export const TRACKER_TOOL_DEFINITIONS = [
    {
        name: "list_tracker_sites",
        description: "추적 중인 사이트(트래커) 목록을 조회합니다. 토큰 권한 범위에 속한 사이트만 반환합니다.",
        inputSchema: { type: "object" as const, properties: {} },
    },
    {
        name: "list_funnels",
        description: "퍼널 목록을 조회합니다. siteId를 생략하면 접근 가능한 모든 사이트의 퍼널을 반환합니다.",
        inputSchema: {
            type: "object" as const,
            properties: { siteId: { type: "number", description: "사이트 ID로 필터링" } },
        },
    },
    {
        name: "get_funnel_analytics",
        description:
            "퍼널의 단계별 방문자 수와 전환율·이탈을 조회합니다. funnelId를 생략하면 사이트의 기본 퍼널을 사용합니다. 날짜를 생략하면 최근 30일입니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                siteId: { type: "number", description: "사이트 ID (필수)" },
                funnelId: { type: "number", description: "퍼널 ID. 생략 시 기본 퍼널" },
                from: { type: "string", description: "시작일 YYYY-MM-DD. 생략 시 30일 전" },
                to: { type: "string", description: "종료일 YYYY-MM-DD. 생략 시 오늘" },
                device: { type: "string", description: "디바이스 필터: desktop | mobile | tablet" },
            },
            required: ["siteId"],
        },
    },
    {
        name: "get_record_journey",
        description:
            "리드(레코드)의 여정을 시간순으로 조회합니다. 사이트 방문·페이지·메일·단계 변경이 하나의 타임라인으로 나옵니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                recordId: { type: "number", description: "레코드 ID (필수)" },
                limit: { type: "number", description: "최근 이벤트 개수 (최대 200)", default: 100 },
            },
            required: ["recordId"],
        },
    },
    {
        name: "get_tracker_overview",
        description:
            "사이트의 방문자·세션·페이지뷰 집계를 조회합니다. 직전 동일 기간과 비교한 증감률도 함께 반환합니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                siteId: { type: "number", description: "사이트 ID (필수)" },
                from: { type: "string", description: "시작일 YYYY-MM-DD. 생략 시 30일 전" },
                to: { type: "string", description: "종료일 YYYY-MM-DD. 생략 시 오늘" },
                device: { type: "string", description: "디바이스 필터: desktop | mobile | tablet" },
            },
            required: ["siteId"],
        },
    },
    {
        name: "get_page_analytics",
        description:
            "페이지별 조회수를 조회합니다. 조회수 많은 순입니다. 날짜를 생략하면 전체 기간입니다(다른 툴과 달리 30일 기본이 아닙니다).",
        inputSchema: {
            type: "object" as const,
            properties: {
                siteId: { type: "number", description: "사이트 ID (필수)" },
                from: { type: "string", description: "시작일 YYYY-MM-DD. 생략 시 전체 기간" },
                to: { type: "string", description: "종료일 YYYY-MM-DD. 생략 시 전체 기간" },
                pageSize: { type: "number", description: "개수 (최대 100)", default: 20 },
            },
            required: ["siteId"],
        },
    },
    {
        name: "list_tracker_events",
        description:
            "트래커 이벤트를 조회합니다. eventName으로 특정 행동만 필터링할 수 있습니다. 전체 건수와 이벤트명별 집계도 함께 반환합니다.",
        inputSchema: {
            type: "object" as const,
            properties: {
                siteId: { type: "number", description: "사이트 ID (필수)" },
                eventName: { type: "string", description: "이벤트 이름 (정확히 일치)" },
                eventType: {
                    type: "string",
                    description: "이벤트 타입: PAGE_VIEW | CUSTOM | CLICK | SECTION_VIEW",
                },
                from: { type: "string", description: "시작일 YYYY-MM-DD. 생략 시 30일 전" },
                to: { type: "string", description: "종료일 YYYY-MM-DD. 생략 시 오늘" },
                page: { type: "number", description: "페이지 번호", default: 1 },
                pageSize: { type: "number", description: "페이지 크기 (최대 100)", default: 20 },
            },
            required: ["siteId"],
        },
    },
];

export function createTrackerToolHandlers(): Record<string, ToolHandler> {
    return {
        list_tracker_sites: async (_args, tokenInfo) => {
            const sites = await listAccessibleTrackerSites(tokenInfo);
            return ok(
                sites.map((s) => ({
                    id: s.id,
                    name: s.name,
                    workspaceId: s.workspaceId,
                    workspaceName: s.workspaceName,
                    domains: s.domains,
                    isActive: s.isActive === 1,
                    conversionStage: s.conversionStage,
                    createdAt: s.createdAt,
                }))
            );
        },

        list_funnels: async (args, tokenInfo) => {
            const siteId = num(args.siteId);
            const sites = await listAccessibleTrackerSites(tokenInfo);
            const targets = siteId ? sites.filter((s) => s.id === siteId) : sites;
            if (siteId && targets.length === 0) return err("트래커를 찾을 수 없습니다.");
            if (targets.length === 0) return ok([]);

            const siteNameById = new Map(targets.map((s) => [s.id, s.name]));
            const funnels = await db
                .select()
                .from(trackerFunnels)
                .where(inArray(trackerFunnels.siteId, targets.map((s) => s.id)));

            return ok(
                funnels.map((f) => ({
                    id: f.id,
                    siteId: f.siteId,
                    siteName: siteNameById.get(f.siteId) ?? null,
                    name: f.name,
                    kind: f.kind,
                    isDefault: f.isDefault === 1,
                    stageCount: f.stages.length,
                    // match.value에 고객사 내부 필드값이 들어 있어 타입만 노출한다
                    stages: f.stages.map((s) => ({ key: s.key, label: s.label, matchType: s.match.type })),
                    createdAt: f.createdAt,
                }))
            );
        },

        get_funnel_analytics: async (args, tokenInfo) => {
            const siteId = num(args.siteId);
            if (!siteId) return err("siteId가 필요합니다.");

            const resolution = await resolveTrackerSiteForToken(tokenInfo, siteId);
            if (!resolution.ok) return err(resolution.error);

            const range = parseRange(args);
            if (typeof range === "string") return err(range);

            const funnelId = num(args.funnelId);
            const funnel = await selectFunnel(siteId, funnelId ?? null);
            // 웹은 타 사이트 퍼널을 조용히 무시하지만, MCP는 Claude가 임의 id를 넣을 수 있어
            // 잘못된 퍼널 수치를 조용히 반환하면 사용자가 틀린 결론을 얻는다
            if (funnelId && !funnel) return err("해당 사이트의 퍼널이 아닙니다.");

            const stages = await computeFunnelStages({
                siteId,
                excludePaths: resolution.site.excludePaths ?? [],
                fromYmd: range.fromYmd,
                toYmd: range.toYmd,
                device: parseDevice(args.device),
                channel: null,
                channelMode: "all",
                funnel,
            });

            const metrics = computeFunnelMetrics(stages);
            return ok({
                funnel: funnel
                    ? { id: funnel.id, name: funnel.name, kind: funnel.kind }
                    : { id: null, name: null, kind: null },
                range: { from: range.fromYmd, to: range.toYmd },
                ...metrics,
            });
        },

        get_record_journey: async (args, tokenInfo) => {
            const recordId = num(args.recordId);
            if (!recordId) return err("recordId가 필요합니다.");

            // 레코드는 파티션 축이라 기존 파티션 스코프 판정을 그대로 쓴다
            const [record] = await db
                .select({ partitionId: records.partitionId })
                .from(records)
                .where(and(eq(records.id, recordId), eq(records.orgId, tokenInfo.orgId)))
                .limit(1);
            if (!record) return err("레코드를 찾을 수 없습니다.");

            const hasAccess = await checkTokenAccess(tokenInfo, record.partitionId, "read");
            if (!hasAccess) return err("이 파티션에 대한 접근 권한이 없습니다.");

            // merge:false 고정 — 기본값(true)은 visitor 링크를 타고 다른 파티션 레코드까지
            // 통합하는데, 위에서 검사한 것은 진입 레코드의 파티션 하나뿐이다.
            // 웹은 세션 유저 기준이라 그 동작이 맞지만 MCP는 파티션 스코프 토큰이 있어
            // 그대로 두면 스코프 밖 레코드의 이력이 새어 나간다.
            const journey = await buildRecordJourney({
                recordId,
                orgId: tokenInfo.orgId,
                merge: false,
            });
            if (!journey) return err("레코드를 찾을 수 없습니다.");

            const limit = clampPageSize(num(args.limit), 100, 200);
            const total = journey.events.length;
            // meta·children은 크기 상한이 없어 제외한다. nextActions는 룰 기반 제안이라
            // Claude의 판단을 오염시키므로 넘기지 않는다.
            const events = journey.events.slice(-limit).map((e) => ({
                at: e.at,
                source: e.source,
                channel: e.channel,
                type: e.type,
                label: e.label,
            }));

            return ok({
                summary: journey.summary,
                attribution: journey.attribution,
                events,
                totalEvents: total,
                truncated: total > events.length,
            });
        },

        get_tracker_overview: async (args, tokenInfo) => {
            const siteId = num(args.siteId);
            if (!siteId) return err("siteId가 필요합니다.");

            const resolution = await resolveTrackerSiteForToken(tokenInfo, siteId);
            if (!resolution.ok) return err(resolution.error);

            const range = parseRange(args);
            if (typeof range === "string") return err(range);

            const prev = previousRange(range.fromYmd, range.toYmd);
            const excludes = resolution.site.excludePaths ?? [];
            const device = parseDevice(args.device);

            const curBounds = rangeBounds(range.fromYmd, range.toYmd);
            const prevBounds = rangeBounds(prev.fromYmd, prev.toYmd);
            const [curSessions, prevSessions] = await Promise.all([
                getSessionIdsByChannel({ siteId, ...curBounds, channel: null, channelMode: "all" }),
                getSessionIdsByChannel({ siteId, ...prevBounds, channel: null, channelMode: "all" }),
            ]);

            const [current, previous] = await Promise.all([
                aggregateRange({ siteId, ...curBounds, excludes, device, sessionIds: curSessions }),
                aggregateRange({ siteId, ...prevBounds, excludes, device, sessionIds: prevSessions }),
            ]);

            const rateOf = (n: number, d: number) => (d === 0 ? null : Number(((n / d) * 100).toFixed(1)));
            return ok({
                range: { from: range.fromYmd, to: range.toYmd },
                previousRange: { from: prev.fromYmd, to: prev.toYmd },
                current,
                previous,
                rates: {
                    bounceRate: rateOf(current.bounces, current.sessions),
                    leadRate: rateOf(current.leads, current.visitors),
                    signupRate: rateOf(current.signups, current.visitors),
                },
                deltaPct: {
                    visitors: pct(current.visitors, previous.visitors),
                    sessions: pct(current.sessions, previous.sessions),
                    pageviews: pct(current.pageviews, previous.pageviews),
                    avgDwell: pct(current.avgDwell, previous.avgDwell),
                    leads: pct(current.leads, previous.leads),
                    signups: pct(current.signups, previous.signups),
                },
            });
        },

        get_page_analytics: async (args, tokenInfo) => {
            const siteId = num(args.siteId);
            if (!siteId) return err("siteId가 필요합니다.");

            const resolution = await resolveTrackerSiteForToken(tokenInfo, siteId);
            if (!resolution.ok) return err(resolution.error);

            // 이 툴만 날짜 기본값이 전 기간이다 — 웹 route의 동작을 보존하기 위함
            const from = str(args.from);
            const to = str(args.to);
            if (from && !isValidYmd(from)) return err("from은 YYYY-MM-DD 형식이어야 합니다.");
            if (to && !isValidYmd(to)) return err("to는 YYYY-MM-DD 형식이어야 합니다.");
            const fromYmd = from ?? "1970-01-01";
            const toYmd = to ?? "2999-12-31";
            if (fromYmd > toYmd) return err("from이 to보다 늦을 수 없습니다.");
            const range = from || to ? rangeBounds(fromYmd, toYmd) : undefined;

            const data = await queryPageAnalytics({
                siteId,
                range,
                limit: clampPageSize(num(args.pageSize), 20, 100),
            });
            // 실제 적용된 경계를 돌려준다 — 원본 인자를 그대로 주면 생략한 쪽이 사라져
            // Claude가 "언제까지 집계인지"를 알 수 없다
            return ok({ range: range ? { from: fromYmd, to: toYmd } : null, pages: data });
        },

        list_tracker_events: async (args, tokenInfo) => {
            const siteId = num(args.siteId);
            if (!siteId) return err("siteId가 필요합니다.");

            const resolution = await resolveTrackerSiteForToken(tokenInfo, siteId);
            if (!resolution.ok) return err(resolution.error);

            const range = parseRange(args);
            if (typeof range === "string") return err(range);
            const { fromIso, toIso } = rangeBounds(range.fromYmd, range.toYmd);

            const eventName = str(args.eventName);
            const eventType = str(args.eventType);
            const page = Math.max(1, num(args.page) ?? 1);
            const pageSize = clampPageSize(num(args.pageSize), 20, 100);

            const conditions = [
                eq(trackerEvents.siteId, siteId),
                sql`${trackerEvents.occurredAt} >= ${fromIso}`,
                sql`${trackerEvents.occurredAt} <= ${toIso}`,
            ];
            if (eventName) conditions.push(eq(trackerEvents.eventName, eventName));
            if (eventType) conditions.push(eq(trackerEvents.eventType, eventType));
            const where = and(...conditions);

            const [[countRow], nameCounts, rows] = await Promise.all([
                db.select({ total: sql<number>`COUNT(*)::int` }).from(trackerEvents).where(where),
                db
                    .select({
                        eventName: trackerEvents.eventName,
                        count: sql<number>`COUNT(*)::int`,
                    })
                    .from(trackerEvents)
                    .where(where)
                    .groupBy(trackerEvents.eventName)
                    .orderBy(desc(sql`COUNT(*)`))
                    .limit(20),
                db
                    .select({
                        id: trackerEvents.id,
                        eventType: trackerEvents.eventType,
                        eventName: trackerEvents.eventName,
                        pageUrl: trackerEvents.pageUrl,
                        pageTitle: trackerEvents.pageTitle,
                        occurredAt: trackerEvents.occurredAt,
                    })
                    .from(trackerEvents)
                    .where(where)
                    .orderBy(desc(trackerEvents.occurredAt))
                    .limit(pageSize)
                    .offset((page - 1) * pageSize),
            ]);

            return ok({
                range: { from: range.fromYmd, to: range.toYmd },
                totalCount: countRow?.total ?? 0,
                eventNameCounts: nameCounts.filter((n) => n.eventName),
                page,
                pageSize,
                events: rows,
            });
        },
    };
}
