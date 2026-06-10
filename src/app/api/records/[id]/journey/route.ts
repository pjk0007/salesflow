import { NextRequest, NextResponse } from "next/server";
import {
    db,
    records,
    recordEvents,
    trackerVisitors,
    trackerEvents,
    trackerSessions,
    emailSendLogs,
    emailClickLogs,
    fieldDefinitions,
    partitions,
    workspaces,
    visitorRecordLinks,
} from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type { JourneyEvent, JourneySummary, StageDuration } from "@/components/journey/types";
import {
    DAY_MS,
    STALE_DAYS,
    loadTrackerLabelMaps,
    normalizeTrackerEvents,
    firstInflowChannel,
    buildAttribution,
    buildNextActions,
} from "@/lib/journey/tracker-journey";

// record_events.type → 채널 라벨
function businessChannel(type: string): string {
    if (type === "match_stage") return "단계";
    if (type === "status") return "상태";
    if (type === "consult") return "상담";
    if (type === "signup") return "가입";
    return type;
}

// 비즈니스 이벤트가 "단계성"인지 (퍼널 계단/소요시간 계산 대상)
function isStageEvent(channel: string): boolean {
    return channel === "단계" || channel === "상태" || channel === "상담" || channel === "가입";
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    const sp = req.nextUrl.searchParams;
    const channelFilter = sp.getAll("channel"); // business|tracker|email
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const fromTs = fromParam ? new Date(fromParam).getTime() : null;
    const toTs = toParam ? new Date(toParam).getTime() : null;

    try {
        // record + orgId 격리
        const [record] = await db
            .select()
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));
        if (!record) {
            return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
        }

        const want = (s: string) => channelFilter.length === 0 || channelFilter.includes(s);
        const merge = sp.get("merge") !== "none";

        // 통합 모드: 이 record에 연결된 visitor들 → 그 visitor들이 연결된 모든 record (1-hop)
        // 그 record들의 이벤트를 한 여정으로. (파티션 경계 넘어 통합)
        let recordIds = [recordId];
        if (merge) {
            const directVisitors = await db
                .select({ visitorId: visitorRecordLinks.visitorId })
                .from(visitorRecordLinks)
                .where(eq(visitorRecordLinks.recordId, recordId));
            // tracker_visitors.record_id 직접 연결분(대표)도 visitor 후보에 포함
            const repVisitors = await db
                .select({ id: trackerVisitors.id })
                .from(trackerVisitors)
                .where(and(eq(trackerVisitors.recordId, recordId), eq(trackerVisitors.orgId, user.orgId)));
            const vIds = [...new Set([...directVisitors.map((v) => v.visitorId), ...repVisitors.map((v) => v.id)])];
            if (vIds.length) {
                const linked = await db
                    .select({ recordId: visitorRecordLinks.recordId })
                    .from(visitorRecordLinks)
                    .where(inArray(visitorRecordLinks.visitorId, vIds));
                const candidateIds = [...new Set([recordId, ...linked.map((l) => l.recordId)])];
                // orgId 격리: 같은 org의 record만
                const orgRecords = await db
                    .select({ id: records.id })
                    .from(records)
                    .where(and(inArray(records.id, candidateIds), eq(records.orgId, user.orgId)));
                recordIds = orgRecords.map((r) => r.id);
            }
        }

        // 병렬 조회 (recordIds 기반)
        const [bizEvents, visitors, sendLogs] = await Promise.all([
            want("business")
                ? db.select().from(recordEvents).where(inArray(recordEvents.recordId, recordIds))
                : Promise.resolve([]),
            want("tracker")
                ? db.select({ id: trackerVisitors.id }).from(trackerVisitors).where(
                    and(inArray(trackerVisitors.recordId, recordIds), eq(trackerVisitors.orgId, user.orgId))
                )
                : Promise.resolve([]),
            want("email")
                ? db.select().from(emailSendLogs).where(
                    and(inArray(emailSendLogs.recordId, recordIds), eq(emailSendLogs.orgId, user.orgId))
                )
                : Promise.resolve([]),
        ]);

        // tracker: record_id 직접 연결 + 링크로 연결된 visitor 모두
        const linkedVisitors = want("tracker")
            ? await db
                .select({ visitorId: visitorRecordLinks.visitorId })
                .from(visitorRecordLinks)
                .where(inArray(visitorRecordLinks.recordId, recordIds))
            : [];
        const visitorIds = [...new Set([...visitors.map((v) => v.id), ...linkedVisitors.map((v) => v.visitorId)])];
        const [trkEvents, trkSessions, clickLogs] = await Promise.all([
            visitorIds.length
                ? db.select().from(trackerEvents).where(inArray(trackerEvents.visitorId, visitorIds))
                : Promise.resolve([]),
            visitorIds.length
                ? db.select().from(trackerSessions).where(inArray(trackerSessions.visitorId, visitorIds))
                : Promise.resolve([]),
            sendLogs.length
                ? db.select().from(emailClickLogs).where(
                    inArray(emailClickLogs.sendLogId, sendLogs.map((s) => s.id))
                )
                : Promise.resolve([]),
        ]);

        // ── normalize ──
        const events: JourneyEvent[] = [];

        // business
        for (const e of bizEvents) {
            const channel = businessChannel(e.type);
            events.push({
                at: e.occurredAt.toISOString(),
                source: "business",
                channel,
                type: e.type,
                label: e.label,
                meta: (e.meta as Record<string, unknown>) ?? {},
            });
        }

        // tracker — 세션 단위 묶기 + 퍼널 단계/별칭 라벨
        const trkSiteIds = [...new Set(trkSessions.map((s) => s.siteId))];
        const labelMaps = await loadTrackerLabelMaps(trkSiteIds);
        events.push(...normalizeTrackerEvents(trkSessions, trkEvents, labelMaps));

        // email — 발송 / 클릭
        for (const s of sendLogs) {
            events.push({
                at: s.sentAt.toISOString(),
                source: "email",
                channel: "메일",
                type: "email_sent",
                label: `메일 발송: ${s.subject ?? "(제목 없음)"}`,
                meta: { subject: s.subject, status: s.status },
            });
        }
        for (const c of clickLogs) {
            events.push({
                at: c.clickedAt.toISOString(),
                source: "email",
                channel: "메일",
                type: "email_click",
                label: "메일 링크 클릭",
                meta: { url: c.url },
            });
        }

        // 기간 필터 + 정렬
        let filtered = events;
        if (fromTs !== null) filtered = filtered.filter((e) => new Date(e.at).getTime() >= fromTs);
        if (toTs !== null) filtered = filtered.filter((e) => new Date(e.at).getTime() <= toTs);
        filtered.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

        const summary = await buildSummary(filtered, record, trkSessions, sendLogs, clickLogs);
        const attribution = buildAttribution(filtered, summary.convertedAt);
        const nextActions = buildNextActions(filtered, summary);

        return NextResponse.json({ success: true, data: { summary, events: filtered, attribution, nextActions } });
    } catch (error) {
        console.error("Journey fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

async function buildSummary(
    events: JourneyEvent[],
    record: typeof records.$inferSelect,
    sessions: (typeof trackerSessions.$inferSelect)[],
    sendLogs: (typeof emailSendLogs.$inferSelect)[],
    clickLogs: (typeof emailClickLogs.$inferSelect)[]
): Promise<JourneySummary> {
    const firstSeenAt = events.length ? events[0].at : null;
    const lastActiveAt = events.length ? events[events.length - 1].at : null;

    // 퍼널 단계 순서 = 추적 select 필드의 options
    const { stageOrder, stageFieldKey } = await loadStageOrder(record.partitionId, record.workspaceId);

    // 단계성 이벤트 (시간순) → 도달 단계 / 소요시간
    const stageEvents = events.filter((e) => isStageEvent(e.channel));
    const reachedStages: string[] = [];
    for (const e of stageEvents) {
        if (!reachedStages.includes(e.label)) reachedStages.push(e.label);
    }
    const stageDurations: StageDuration[] = [];
    for (let i = 1; i < stageEvents.length; i++) {
        const prev = stageEvents[i - 1];
        const cur = stageEvents[i];
        const days = Math.round((new Date(cur.at).getTime() - new Date(prev.at).getTime()) / DAY_MS);
        stageDurations.push({ from: prev.label, to: cur.label, days });
    }

    // 현재 단계 = record.data[stageFieldKey] 또는 마지막 단계 이벤트
    const data = record.data as Record<string, unknown>;
    const currentStage = (stageFieldKey && (data[stageFieldKey] as string)) ||
        (stageEvents.length ? stageEvents[stageEvents.length - 1].label : null);

    // 전환 = 퍼널 마지막 단계 도달. stageOrder 없으면 도달 단계의 마지막을 전환으로 폴백.
    let convertedAt: string | null = null;
    const lastStage = stageOrder.length
        ? stageOrder[stageOrder.length - 1]
        : (reachedStages.length ? reachedStages[reachedStages.length - 1] : null);
    if (lastStage) {
        // 그 단계의 가장 마지막 도달 이벤트
        const hits = stageEvents.filter((e) => e.label === lastStage);
        convertedAt = hits.length ? hits[hits.length - 1].at : null;
    }
    const daysToConvert =
        firstSeenAt && convertedAt
            ? Math.round((new Date(convertedAt).getTime() - new Date(firstSeenAt).getTime()) / DAY_MS)
            : null;

    // 채널 카운트
    const channels: Record<string, number> = {};
    for (const e of events) channels[e.source] = (channels[e.source] ?? 0) + 1;

    // 활동 밀도
    const visits = sessions.length || events.filter((e) => e.channel === "사이트").length;
    const emailSent = sendLogs.length;
    const emailClicks = clickLogs.length;
    const dwells = sessions.map((s) => s.duration ?? 0).filter((d) => d > 0);
    const avgDwellSec = dwells.length ? Math.round(dwells.reduce((a, b) => a + b, 0) / dwells.length) : 0;

    // 이탈
    const daysSince = lastActiveAt
        ? Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / DAY_MS)
        : 0;

    // 일별 활동량
    const dailyMap = new Map<string, number>();
    for (const e of events) {
        const day = e.at.slice(0, 10);
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
    }
    const dailyActivity = [...dailyMap.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        firstSeenAt,
        convertedAt,
        daysToConvert,
        totalEvents: events.length,
        currentStage,
        stages: stageOrder.length ? stageOrder : reachedStages,
        reachedStages,
        stageDurations,
        firstChannel: firstInflowChannel(events) ?? (events.length ? events[0].channel : null),
        channels,
        density: {
            visits,
            emailSent,
            emailClicks,
            emailClickRate: emailSent ? Number((emailClicks / emailSent).toFixed(2)) : 0,
            avgDwellSec,
            sessions: sessions.length,
        },
        inactivity: { lastActiveAt, daysSince, isStale: daysSince >= STALE_DAYS },
        dailyActivity,
    };
}

// 추적 켠 select 필드의 옵션 순서를 퍼널 순서로
async function loadStageOrder(
    partitionId: number,
    workspaceId: number
): Promise<{ stageOrder: string[]; stageFieldKey: string | null }> {
    const [partition] = await db
        .select({ fieldTypeId: partitions.fieldTypeId })
        .from(partitions)
        .where(eq(partitions.id, partitionId));
    let resolvedTypeId = partition?.fieldTypeId ?? null;
    if (!resolvedTypeId) {
        const [ws] = await db
            .select({ defaultFieldTypeId: workspaces.defaultFieldTypeId })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId));
        resolvedTypeId = ws?.defaultFieldTypeId ?? null;
    }
    if (!resolvedTypeId) return { stageOrder: [], stageFieldKey: null };

    const tracked = await db
        .select({ key: fieldDefinitions.key, options: fieldDefinitions.options })
        .from(fieldDefinitions)
        .where(
            and(
                eq(fieldDefinitions.fieldTypeId, resolvedTypeId),
                eq(fieldDefinitions.trackHistory, 1),
                eq(fieldDefinitions.fieldType, "select")
            )
        );
    // 첫 추적 select 필드를 퍼널 기준으로 사용
    const f = tracked[0];
    return { stageOrder: (f?.options as string[]) ?? [], stageFieldKey: f?.key ?? null };
}
