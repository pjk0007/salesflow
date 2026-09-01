import { db, trackerFunnels } from "@/lib/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
    AUTO_STAGE_LEAD,
    AUTO_STAGE_VISIT,
    computeSequentialStageCounts,
    getStageVisitorIds,
} from "@/lib/tracker/funnel-analytics";
import { getSessionIdsByChannel } from "@/lib/tracker/session-filter";
import { deviceFilterSql, sessionInFilterSql } from "@/lib/tracker/sql-filters";
import { rangeBounds } from "@/lib/tracker/date-range";
import type { FunnelKind, FunnelStageResult, StageMatch } from "@/components/tracker/types/funnel";

/**
 * 퍼널 집계. funnel route의 몸통을 그대로 옮긴 것이며 웹과 MCP가 공유한다.
 * 여기서 수치가 달라지면 기존 대시보드가 조용히 틀린 값을 보여주므로,
 * route에 있던 SQL·분기를 한 글자도 바꾸지 않았다.
 */

export interface FunnelInfo {
    id: number;
    name: string;
    kind: FunnelKind;
    stages: { key: string; label: string; match: StageMatch }[];
}

/**
 * 퍼널 선택 — funnelId를 주면 그것, 없으면 사이트의 기본 퍼널.
 * 기본(funnelId 미지정)은 marketing 한정이 아니라 is_default 플래그를 본다.
 */
export async function selectFunnel(siteId: number, funnelId?: number | null): Promise<FunnelInfo | null> {
    if (funnelId) {
        const [f] = await db
            .select()
            .from(trackerFunnels)
            .where(and(eq(trackerFunnels.id, funnelId), eq(trackerFunnels.siteId, siteId)));
        return f ? { id: f.id, name: f.name, kind: f.kind as FunnelKind, stages: f.stages } : null;
    }
    const [f] = await db
        .select()
        .from(trackerFunnels)
        .where(and(eq(trackerFunnels.siteId, siteId), eq(trackerFunnels.isDefault, 1)))
        .orderBy(desc(trackerFunnels.createdAt))
        .limit(1);
    return f ? { id: f.id, name: f.name, kind: f.kind as FunnelKind, stages: f.stages } : null;
}

export interface FunnelStagesArgs {
    siteId: number;
    excludePaths: string[];
    fromYmd: string;
    toYmd: string;
    device: string | null;
    channel: string | null;
    channelMode: "all" | "paid" | "organic";
    funnel: FunnelInfo | null;
}

/**
 * 단계별 방문자 수를 계산한다.
 *
 * marketing 퍼널: 방문/리드 자동단계 + 사용자 단계 sequential 역산
 * event 퍼널: 자동 리드단계 없음 + cumulative 역산 미적용
 *   (역산 미적용이라 뒤 단계가 앞보다 클 수 있다 — 소비자가 음수 이탈을 만들지 않도록 주의)
 */
export async function computeFunnelStages(args: FunnelStagesArgs): Promise<FunnelStageResult[]> {
    const { siteId, excludePaths, fromYmd, toYmd, device, channel, channelMode, funnel } = args;
    const { fromIso, toIso } = rangeBounds(fromYmd, toYmd);

    const sessionIds = await getSessionIdsByChannel({ siteId, fromIso, toIso, channel, channelMode });

    // notExcludedExpr — funnel route의 인라인 정규식을 그대로 옮긴다
    const notExcluded =
        excludePaths.length === 0
            ? sql`TRUE`
            : sql`NOT (${sql.join(
                  excludePaths.map(
                      (p) =>
                          sql`regexp_replace(split_part(page_url, '?', 1), '^https?://[^/]+', '') LIKE ${p + "%"}`
                  ),
                  sql` OR `
              )})`;

    const devFilterTv = deviceFilterSql(device, "tv");
    const sessFilterEv = sessionInFilterSql(sessionIds, "ev.session_id");

    // 1단(visit) 후보 집합 — aggregateRange와 동일 정의
    const meaningfulVisitorIdsSql = sql`(
        SELECT DISTINCT tv.id
        FROM tracker_visitors tv
        JOIN tracker_events ev ON ev.visitor_id = tv.id
        WHERE tv.site_id = ${siteId}
          AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
          AND ev.event_type = 'PAGE_VIEW'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          AND ${notExcluded}
          ${devFilterTv}
          ${sessFilterEv}
    )`;

    const [vRow] = (await db.execute(sql`
        SELECT
            COUNT(*)::int AS visitors,
            COUNT(*) FILTER (WHERE
                record_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM visitor_record_links vrl WHERE vrl.visitor_id = tracker_visitors.id)
            )::int AS leads
        FROM tracker_visitors
        WHERE id IN ${meaningfulVisitorIdsSql}
    `)) as unknown as Array<{ visitors: number; leads: number }>;

    if (funnel && funnel.kind === "event") {
        // 행동(event) 퍼널: 각 custom_event 단계의 실제 발생 visitor 수를 그대로 카운트
        const eventStageCounts = await Promise.all(
            funnel.stages.map((stage) =>
                getStageVisitorIds({ siteId, meaningfulVisitorIdsSql }, stage.match).then((set) => set.size)
            )
        );
        return [
            { key: AUTO_STAGE_VISIT, label: "방문", visitors: vRow.visitors, isAuto: true },
            ...funnel.stages.map((stage, i) => ({
                key: stage.key,
                label: stage.label,
                visitors: eventStageCounts[i] ?? 0,
            })),
        ];
    }

    // 마케팅(marketing) 퍼널: 방문/리드 자동단계 + 사용자 단계 sequential 역산
    const userStageCounts = funnel
        ? await computeSequentialStageCounts({ siteId, meaningfulVisitorIdsSql }, funnel.stages)
        : [];

    // Sequential 보정: 사용자 정의 단계 도달자는 리드도 통과한 것으로 본다
    const topUserStageReached = userStageCounts[0] ?? 0;
    const adjustedLeads = Math.max(vRow.leads, topUserStageReached);

    const stages: FunnelStageResult[] = [
        { key: AUTO_STAGE_VISIT, label: "방문", visitors: vRow.visitors, isAuto: true },
        { key: AUTO_STAGE_LEAD, label: "리드", visitors: adjustedLeads, isAuto: true },
    ];
    if (funnel) {
        funnel.stages.forEach((stage, i) => {
            stages.push({ key: stage.key, label: stage.label, visitors: userStageCounts[i] ?? 0 });
        });
    }
    return stages;
}
